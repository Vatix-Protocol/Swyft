#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol,
};

pub const Q96: u128 = 1u128 << 96;
pub const FEE_DENOMINATOR: u128 = 1_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PoolError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidTickRange = 3,
    ZeroLiquidity = 4,
    PositionNotFound = 5,
    Unauthorized = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct Position {
    pub owner: Address,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
    pub fee_growth_inside_0_last: u128,
    pub fee_growth_inside_1_last: u128,
    pub tokens_owed_0: u128,
    pub tokens_owed_1: u128,
    pub nft_id: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Initialized,
    Token0,
    Token1,
    FeeTier,
    SqrtPriceX96,
    CurrentTick,
    Liquidity,
    FeeGrowthGlobal0,
    FeeGrowthGlobal1,
    NftContract,
    NextPositionId,
    Position(u64),
}

#[contract]
pub struct ClPool;

#[contractimpl]
impl ClPool {
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "cl_pool")
    }

    pub fn initialize(
        env: Env,
        token_0: Address,
        token_1: Address,
        fee_tier: u32,
        sqrt_price_x96: u128,
        nft_contract: Address,
    ) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Initialized)
            .unwrap_or(false)
        {
            panic_with_error!(&env, PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Token0, &token_0);
        env.storage().instance().set(&DataKey::Token1, &token_1);
        env.storage().instance().set(&DataKey::FeeTier, &fee_tier);
        env.storage()
            .instance()
            .set(&DataKey::SqrtPriceX96, &sqrt_price_x96);
        env.storage()
            .instance()
            .set(&DataKey::CurrentTick, &sqrt_price_to_tick(sqrt_price_x96));
        env.storage().instance().set(&DataKey::Liquidity, &0u128);
        env.storage()
            .instance()
            .set(&DataKey::FeeGrowthGlobal0, &0u128);
        env.storage()
            .instance()
            .set(&DataKey::FeeGrowthGlobal1, &0u128);
        env.storage()
            .instance()
            .set(&DataKey::NftContract, &nft_contract);
        env.storage()
            .instance()
            .set(&DataKey::NextPositionId, &0u64);
    }

    /// Adds concentrated liquidity within [tick_lower, tick_upper].
    /// Returns (position_id, amount_0_used, amount_1_used).
    pub fn add_liquidity(
        env: Env,
        owner: Address,
        tick_lower: i32,
        tick_upper: i32,
        liquidity: u128,
    ) -> (u64, u128, u128) {
        owner.require_auth();
        ensure_initialized(&env);

        if tick_lower >= tick_upper {
            panic_with_error!(&env, PoolError::InvalidTickRange);
        }
        if liquidity == 0 {
            panic_with_error!(&env, PoolError::ZeroLiquidity);
        }

        let sqrt_price: u128 = env
            .storage()
            .instance()
            .get(&DataKey::SqrtPriceX96)
            .unwrap();
        let current_tick: i32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentTick)
            .unwrap();

        let sqrt_lower = tick_to_sqrt_price(tick_lower);
        let sqrt_upper = tick_to_sqrt_price(tick_upper);

        let (amount_0, amount_1) =
            amounts_for_liquidity(liquidity, sqrt_lower, sqrt_upper, sqrt_price);

        let token_0: Address = env.storage().instance().get(&DataKey::Token0).unwrap();
        let token_1: Address = env.storage().instance().get(&DataKey::Token1).unwrap();

        if amount_0 > 0 {
            token::Client::new(&env, &token_0).transfer(
                &owner,
                &env.current_contract_address(),
                &(amount_0 as i128),
            );
        }
        if amount_1 > 0 {
            token::Client::new(&env, &token_1).transfer(
                &owner,
                &env.current_contract_address(),
                &(amount_1 as i128),
            );
        }

        // Update active liquidity if position is in range
        if current_tick >= tick_lower && current_tick < tick_upper {
            let active: u128 = env
                .storage()
                .instance()
                .get(&DataKey::Liquidity)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::Liquidity, &(active + liquidity));
        }

        let fee_growth_0: u128 = env
            .storage()
            .instance()
            .get(&DataKey::FeeGrowthGlobal0)
            .unwrap_or(0);
        let fee_growth_1: u128 = env
            .storage()
            .instance()
            .get(&DataKey::FeeGrowthGlobal1)
            .unwrap_or(0);

        // Mint NFT
        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .unwrap();
        let nft_client = position_nft::PositionNftClient::new(&env, &nft_contract);
        let nft_id = nft_client.mint(
            &owner,
            &env.current_contract_address(),
            &tick_lower,
            &tick_upper,
            &liquidity,
        );

        let pos_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextPositionId)
            .unwrap_or(0);

        let position = Position {
            owner,
            tick_lower,
            tick_upper,
            liquidity,
            fee_growth_inside_0_last: fee_growth_inside(fee_growth_0, tick_lower, tick_upper, current_tick),
            fee_growth_inside_1_last: fee_growth_inside(fee_growth_1, tick_lower, tick_upper, current_tick),
            tokens_owed_0: 0,
            tokens_owed_1: 0,
            nft_id,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Position(pos_id), &position);
        env.storage()
            .instance()
            .set(&DataKey::NextPositionId, &(pos_id + 1));

        env.events().publish(
            (Symbol::new(&env, "AddLiquidity"),),
            (pos_id, liquidity, amount_0, amount_1),
        );

        (pos_id, amount_0, amount_1)
    }

    /// Executes a swap. zero_for_one = true means token0 → token1.
    /// Returns (amount_0_delta, amount_1_delta).
    pub fn swap(
        env: Env,
        sender: Address,
        zero_for_one: bool,
        amount_in: u128,
        sqrt_price_limit_x96: u128,
    ) -> (i128, i128) {
        sender.require_auth();
        ensure_initialized(&env);

        let fee_tier: u32 = env.storage().instance().get(&DataKey::FeeTier).unwrap();
        let fee_amount = amount_in * fee_tier as u128 / FEE_DENOMINATOR;
        let amount_after_fee = amount_in - fee_amount;

        let sqrt_price: u128 = env
            .storage()
            .instance()
            .get(&DataKey::SqrtPriceX96)
            .unwrap();
        let liquidity: u128 = env
            .storage()
            .instance()
            .get(&DataKey::Liquidity)
            .unwrap_or(0);

        let token_0: Address = env.storage().instance().get(&DataKey::Token0).unwrap();
        let token_1: Address = env.storage().instance().get(&DataKey::Token1).unwrap();

        let (amount_0_delta, amount_1_delta, new_sqrt_price) = if zero_for_one {
            let new_price = next_sqrt_price_from_input(sqrt_price, liquidity, amount_after_fee, true);
            let new_price = if new_price < sqrt_price_limit_x96 {
                sqrt_price_limit_x96
            } else {
                new_price
            };
            let out = get_amount_1_out(liquidity, new_price, sqrt_price);
            (amount_in as i128, -(out as i128), new_price)
        } else {
            let new_price = next_sqrt_price_from_input(sqrt_price, liquidity, amount_after_fee, false);
            let new_price = if new_price > sqrt_price_limit_x96 {
                sqrt_price_limit_x96
            } else {
                new_price
            };
            let out = get_amount_0_out(liquidity, sqrt_price, new_price);
            (-(out as i128), amount_in as i128, new_price)
        };

        // Transfer tokens
        if amount_0_delta > 0 {
            token::Client::new(&env, &token_0).transfer(
                &sender,
                &env.current_contract_address(),
                &amount_0_delta,
            );
        } else if amount_0_delta < 0 {
            token::Client::new(&env, &token_0).transfer(
                &env.current_contract_address(),
                &sender,
                &(-amount_0_delta),
            );
        }
        if amount_1_delta > 0 {
            token::Client::new(&env, &token_1).transfer(
                &sender,
                &env.current_contract_address(),
                &amount_1_delta,
            );
        } else if amount_1_delta < 0 {
            token::Client::new(&env, &token_1).transfer(
                &env.current_contract_address(),
                &sender,
                &(-amount_1_delta),
            );
        }

        // Accumulate fee growth
        if liquidity > 0 {
            if zero_for_one {
                let fg: u128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::FeeGrowthGlobal0)
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::FeeGrowthGlobal0, &(fg + fee_amount * Q96 / liquidity));
            } else {
                let fg: u128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::FeeGrowthGlobal1)
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::FeeGrowthGlobal1, &(fg + fee_amount * Q96 / liquidity));
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::SqrtPriceX96, &new_sqrt_price);
        env.storage()
            .instance()
            .set(&DataKey::CurrentTick, &sqrt_price_to_tick(new_sqrt_price));

        env.events().publish(
            (Symbol::new(&env, "Swap"),),
            (zero_for_one, amount_0_delta, amount_1_delta),
        );

        (amount_0_delta, amount_1_delta)
    }

    /// Collects accrued fees for a position. Returns (fee_0, fee_1).
    pub fn collect(env: Env, owner: Address, position_id: u64) -> (u128, u128) {
        owner.require_auth();
        ensure_initialized(&env);

        let mut position: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(position_id))
            .unwrap_or_else(|| panic_with_error!(&env, PoolError::PositionNotFound));

        if position.owner != owner {
            panic_with_error!(&env, PoolError::Unauthorized);
        }

        let current_tick: i32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentTick)
            .unwrap();
        let fg0: u128 = env
            .storage()
            .instance()
            .get(&DataKey::FeeGrowthGlobal0)
            .unwrap_or(0);
        let fg1: u128 = env
            .storage()
            .instance()
            .get(&DataKey::FeeGrowthGlobal1)
            .unwrap_or(0);

        let inside_0 = fee_growth_inside(fg0, position.tick_lower, position.tick_upper, current_tick);
        let inside_1 = fee_growth_inside(fg1, position.tick_lower, position.tick_upper, current_tick);

        let owed_0 = position.tokens_owed_0
            + (inside_0.wrapping_sub(position.fee_growth_inside_0_last)) * position.liquidity / Q96;
        let owed_1 = position.tokens_owed_1
            + (inside_1.wrapping_sub(position.fee_growth_inside_1_last)) * position.liquidity / Q96;

        position.fee_growth_inside_0_last = inside_0;
        position.fee_growth_inside_1_last = inside_1;
        position.tokens_owed_0 = 0;
        position.tokens_owed_1 = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Position(position_id), &position);

        let token_0: Address = env.storage().instance().get(&DataKey::Token0).unwrap();
        let token_1: Address = env.storage().instance().get(&DataKey::Token1).unwrap();

        if owed_0 > 0 {
            token::Client::new(&env, &token_0).transfer(
                &env.current_contract_address(),
                &owner,
                &(owed_0 as i128),
            );
        }
        if owed_1 > 0 {
            token::Client::new(&env, &token_1).transfer(
                &env.current_contract_address(),
                &owner,
                &(owed_1 as i128),
            );
        }

        (owed_0, owed_1)
    }

    /// Removes liquidity from a position. Burns NFT if fully removed.
    /// Returns (amount_0, amount_1).
    pub fn remove_liquidity(
        env: Env,
        owner: Address,
        position_id: u64,
        liquidity_to_remove: u128,
    ) -> (u128, u128) {
        owner.require_auth();
        ensure_initialized(&env);

        let mut position: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(position_id))
            .unwrap_or_else(|| panic_with_error!(&env, PoolError::PositionNotFound));

        if position.owner != owner {
            panic_with_error!(&env, PoolError::Unauthorized);
        }
        if liquidity_to_remove == 0 || liquidity_to_remove > position.liquidity {
            panic_with_error!(&env, PoolError::ZeroLiquidity);
        }

        let sqrt_price: u128 = env
            .storage()
            .instance()
            .get(&DataKey::SqrtPriceX96)
            .unwrap();
        let current_tick: i32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentTick)
            .unwrap();

        let sqrt_lower = tick_to_sqrt_price(position.tick_lower);
        let sqrt_upper = tick_to_sqrt_price(position.tick_upper);

        let (amount_0, amount_1) =
            amounts_for_liquidity(liquidity_to_remove, sqrt_lower, sqrt_upper, sqrt_price);

        // Update active liquidity
        if current_tick >= position.tick_lower && current_tick < position.tick_upper {
            let active: u128 = env
                .storage()
                .instance()
                .get(&DataKey::Liquidity)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::Liquidity, &active.saturating_sub(liquidity_to_remove));
        }

        let token_0: Address = env.storage().instance().get(&DataKey::Token0).unwrap();
        let token_1: Address = env.storage().instance().get(&DataKey::Token1).unwrap();

        if amount_0 > 0 {
            token::Client::new(&env, &token_0).transfer(
                &env.current_contract_address(),
                &owner,
                &(amount_0 as i128),
            );
        }
        if amount_1 > 0 {
            token::Client::new(&env, &token_1).transfer(
                &env.current_contract_address(),
                &owner,
                &(amount_1 as i128),
            );
        }

        position.liquidity -= liquidity_to_remove;

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .unwrap();

        if position.liquidity == 0 {
            // Burn NFT and remove position
            let nft_client = position_nft::PositionNftClient::new(&env, &nft_contract);
            nft_client.burn(&position.nft_id);
            env.storage()
                .persistent()
                .remove(&DataKey::Position(position_id));
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::Position(position_id), &position);
            // Update NFT metadata
            let nft_client = position_nft::PositionNftClient::new(&env, &nft_contract);
            nft_client.mint(
                &owner,
                &env.current_contract_address(),
                &position.tick_lower,
                &position.tick_upper,
                &position.liquidity,
            );
        }

        env.events().publish(
            (Symbol::new(&env, "RemoveLiquidity"),),
            (position_id, liquidity_to_remove, amount_0, amount_1),
        );

        (amount_0, amount_1)
    }

    pub fn get_position(env: Env, position_id: u64) -> Option<Position> {
        env.storage()
            .persistent()
            .get(&DataKey::Position(position_id))
    }

    pub fn get_sqrt_price(env: Env) -> u128 {
        env.storage()
            .instance()
            .get(&DataKey::SqrtPriceX96)
            .unwrap_or(0)
    }

    pub fn get_liquidity(env: Env) -> u128 {
        env.storage()
            .instance()
            .get(&DataKey::Liquidity)
            .unwrap_or(0)
    }

    pub fn get_fee_growth_global(env: Env) -> (u128, u128) {
        let fg0 = env
            .storage()
            .instance()
            .get(&DataKey::FeeGrowthGlobal0)
            .unwrap_or(0);
        let fg1 = env
            .storage()
            .instance()
            .get(&DataKey::FeeGrowthGlobal1)
            .unwrap_or(0);
        (fg0, fg1)
    }
}

// ── Math helpers ─────────────────────────────────────────────────────────────

/// Approximate tick from sqrt price using log base 1.0001.
pub fn sqrt_price_to_tick(sqrt_price_x96: u128) -> i32 {
    if sqrt_price_x96 == 0 {
        return 0;
    }
    // log_1.0001(price) = log_1.0001((sqrt_price/2^96)^2)
    // ≈ 2 * (sqrt_price - 2^96) / (2^96 * ln(1.0001))  for small deviations
    // Use integer approximation: tick ≈ (sqrt_price_x96 / Q96 - 1) * 20000
    if sqrt_price_x96 >= Q96 {
        let ratio = (sqrt_price_x96 - Q96) as i64;
        let q = Q96 as i64;
        ((ratio * 20000) / q) as i32
    } else {
        let ratio = (Q96 - sqrt_price_x96) as i64;
        let q = Q96 as i64;
        -((ratio * 20000) / q) as i32
    }
}

/// Approximate sqrt price from tick: sqrt(1.0001^tick) * 2^96.
pub fn tick_to_sqrt_price(tick: i32) -> u128 {
    // sqrt(1.0001^tick) ≈ 1 + tick * ln(1.0001)/2 ≈ 1 + tick * 0.00005
    // In Q96: Q96 + tick * Q96 / 20000
    if tick >= 0 {
        Q96 + (tick as u128) * Q96 / 20000
    } else {
        let abs = (-tick) as u128;
        Q96.saturating_sub(abs * Q96 / 20000)
    }
}

fn amounts_for_liquidity(
    liquidity: u128,
    sqrt_lower: u128,
    sqrt_upper: u128,
    sqrt_current: u128,
) -> (u128, u128) {
    let sqrt_current = sqrt_current.clamp(sqrt_lower, sqrt_upper);
    let amount_0 = liquidity * Q96 / sqrt_lower - liquidity * Q96 / sqrt_upper;
    let amount_1 = liquidity * (sqrt_current - sqrt_lower) / Q96;
    (amount_0, amount_1)
}

fn next_sqrt_price_from_input(
    sqrt_price: u128,
    liquidity: u128,
    amount_in: u128,
    zero_for_one: bool,
) -> u128 {
    if liquidity == 0 {
        return sqrt_price;
    }
    if zero_for_one {
        // price decreases: new = L * sqrt / (L + amount * sqrt / Q96)
        let denom = liquidity + amount_in * sqrt_price / Q96;
        if denom == 0 {
            return sqrt_price;
        }
        liquidity * sqrt_price / denom
    } else {
        // price increases: new = sqrt + amount * Q96 / L
        sqrt_price + amount_in * Q96 / liquidity
    }
}

fn get_amount_1_out(liquidity: u128, new_sqrt: u128, old_sqrt: u128) -> u128 {
    if old_sqrt <= new_sqrt {
        return 0;
    }
    liquidity * (old_sqrt - new_sqrt) / Q96
}

fn get_amount_0_out(liquidity: u128, old_sqrt: u128, new_sqrt: u128) -> u128 {
    if new_sqrt == 0 || old_sqrt == 0 || new_sqrt >= old_sqrt {
        return 0;
    }
    liquidity * Q96 / new_sqrt - liquidity * Q96 / old_sqrt
}

/// Returns the fee growth inside a tick range.
fn fee_growth_inside(
    fee_growth_global: u128,
    tick_lower: i32,
    tick_upper: i32,
    current_tick: i32,
) -> u128 {
    if current_tick >= tick_lower && current_tick < tick_upper {
        fee_growth_global
    } else {
        0
    }
}

fn ensure_initialized(env: &Env) {
    if !env
        .storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
    {
        panic_with_error!(env, PoolError::NotInitialized);
    }
}

mod test;
