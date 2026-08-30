#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, IntoVal, Map, Symbol,
};

pub const Q96: u128 = 1u128 << 96;
pub const FEE_DENOMINATOR: u128 = 1_000_000;
pub const MIN_TICK: i32 = -887_272;
pub const MAX_TICK: i32 = 887_272;

/// Maximum number of initialized ticks a single swap may cross. Guards against
/// pathologically large swaps / sparse tick ladders exhausting the ledger.
pub const MAX_SWAP_ITERATIONS: u32 = 255;

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
    InvalidTick = 7,
    Overflow = 8,
    InsufficientLiquidity = 9,
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

/// Per-tick liquidity counters used by concentrated-liquidity swaps.
/// A position contributes `liquidity` at tick_lower and removes it at
/// tick_upper, so crossing a tick adjusts active liquidity by `liquidity_net`.
#[contracttype]
#[derive(Clone)]
pub struct TickInfo {
    pub liquidity_gross: u128,
    pub liquidity_net: i128,
    pub fee_growth_outside_0: u128,
    pub fee_growth_outside_1: u128,
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
    TickSpacing,
    // Map<i32, TickInfo> keyed by initialized tick index.
    Ticks,
    // Tick bitmap for efficient next-initialized-tick lookup. Map<i32, u128>.
    Bitmap,
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
            panic_pool_error(&env, PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Token0, &token_0);
        env.storage().instance().set(&DataKey::Token1, &token_1);
        env.storage().instance().set(&DataKey::FeeTier, &fee_tier);
        env.storage()
            .instance()
            .set(&DataKey::TickSpacing, &fee_tier_to_tick_spacing(fee_tier));
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
            panic_pool_error(&env, PoolError::InvalidTickRange);
        }
        if liquidity == 0 {
            panic_pool_error(&env, PoolError::ZeroLiquidity);
        }

        let tick_spacing: i32 = env
            .storage()
            .instance()
            .get(&DataKey::TickSpacing)
            .unwrap();
        validate_tick(&env, tick_lower, tick_spacing);
        validate_tick(&env, tick_upper, tick_spacing);

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

        // Record the position's contribution to its boundary ticks.
        let lower_flipped = update_tick(&env, tick_lower, liquidity as i128, false);
        let upper_flipped = update_tick(&env, tick_upper, liquidity as i128, true);
        flip_bitmap(&env, tick_lower, tick_spacing, lower_flipped);
        flip_bitmap(&env, tick_upper, tick_spacing, upper_flipped);

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
        let nft_id: u64 = env.invoke_contract(
            &nft_contract,
            &Symbol::new(&env, "mint"),
            soroban_sdk::vec![
                &env,
                owner.into_val(&env),
                env.current_contract_address().into_val(&env),
                tick_lower.into_val(&env),
                tick_upper.into_val(&env),
                liquidity.into_val(&env),
            ],
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

    /// Executes a concentrated-liquidity swap.
    ///
    /// A swap is a single price move that consumes input across one or more
    /// initialized-tick segments. Within each segment active liquidity is
    /// constant; when the remaining input would push the price past the next
    /// initialized tick, that tick is crossed (active liquidity is rebalanced
    /// by its `liquidity_net`) and trading continues until the input is
    /// exhausted or the price limit is reached.
    ///
    /// zero_for_one = true means token0 → token1 (price decreases).
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
        let tick_spacing: i32 = env
            .storage()
            .instance()
            .get(&DataKey::TickSpacing)
            .unwrap();

        let fee_amount = amount_in * fee_tier as u128 / FEE_DENOMINATOR;
        let mut amount_remaining = amount_in - fee_amount;

        if amount_remaining == 0 {
            panic_pool_error(&env, PoolError::ZeroLiquidity);
        }

        let mut sqrt_price: u128 = env
            .storage()
            .instance()
            .get(&DataKey::SqrtPriceX96)
            .unwrap();
        let mut liquidity: u128 = env
            .storage()
            .instance()
            .get(&DataKey::Liquidity)
            .unwrap_or(0);
        let mut current_tick: i32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentTick)
            .unwrap();

        if liquidity == 0 {
            panic_pool_error(&env, PoolError::ZeroLiquidity);
        }

        let token_0: Address = env.storage().instance().get(&DataKey::Token0).unwrap();
        let token_1: Address = env.storage().instance().get(&DataKey::Token1).unwrap();

        let mut amount_out: u128 = 0;
        let mut ticks_crossed: u32 = 0;
        let mut fee_growth_delta_0: u128 = 0;
        let mut fee_growth_delta_1: u128 = 0;

        while amount_remaining > 0 {
            if ticks_crossed >= MAX_SWAP_ITERATIONS {
                panic_pool_error(&env, PoolError::InsufficientLiquidity);
            }

            // Search strictly below (zero_for_one) or strictly above the current
            // tick so we never re-cross the tick we just landed on.
            let search_from = if zero_for_one {
                current_tick - 1
            } else {
                current_tick
            };
            let (next_tick, initialized) =
                next_initialized_tick(&env, search_from, tick_spacing, zero_for_one);

            let mut target_sqrt = if initialized {
                tick_to_sqrt_price(next_tick)
            } else if zero_for_one {
                tick_to_sqrt_price(MIN_TICK)
            } else {
                tick_to_sqrt_price(MAX_TICK)
            };

            // Respect the caller's price limit (tighten the segment boundary).
            if zero_for_one && target_sqrt <= sqrt_price_limit_x96 {
                target_sqrt = sqrt_price_limit_x96;
            } else if !zero_for_one && target_sqrt >= sqrt_price_limit_x96 {
                target_sqrt = sqrt_price_limit_x96;
            }

            let (amount_consumed, amount_to_cross) = if zero_for_one {
                (
                    get_amount_0_delta(sqrt_price, target_sqrt, liquidity, true),
                    get_amount_1_delta(sqrt_price, target_sqrt, liquidity, false),
                )
            } else {
                (
                    get_amount_1_delta(sqrt_price, target_sqrt, liquidity, true),
                    get_amount_0_delta(sqrt_price, target_sqrt, liquidity, false),
                )
            };

            if amount_remaining >= amount_consumed {
                // Move fully to the target (tick boundary or price limit).
                amount_out += amount_to_cross;
                amount_remaining -= amount_consumed;
                accumulate_segment_fee(
                    &mut fee_growth_delta_0,
                    &mut fee_growth_delta_1,
                    zero_for_one,
                    amount_consumed,
                    fee_tier,
                    liquidity,
                );
                sqrt_price = target_sqrt;

                let at_limit =
                    (zero_for_one && sqrt_price <= sqrt_price_limit_x96)
                        || (!zero_for_one && sqrt_price >= sqrt_price_limit_x96);

                // No input remains, the price limit was hit, or there are no more
                // initialized ticks to cross — stop before changing liquidity.
                if amount_remaining == 0 || at_limit || !initialized {
                    break;
                }

                // Cross the initialized tick and rebalance active liquidity.
                let net = net_at_tick(&env, next_tick);
                liquidity = if zero_for_one {
                    liquidity.saturating_sub(net)
                } else {
                    liquidity.saturating_add(net)
                };
                cross_tick(&env, next_tick, zero_for_one);
                current_tick = next_tick;
                ticks_crossed += 1;

                if liquidity == 0 {
                    // Trading can no longer continue past the last active range.
                    break;
                }
            } else {
                // Partial step within the current segment.
                let next_sqrt =
                    next_sqrt_price_from_input(sqrt_price, liquidity, amount_remaining, zero_for_one);
                let partial_out = if zero_for_one {
                    get_amount_1_delta(sqrt_price, next_sqrt, liquidity, false)
                } else {
                    get_amount_0_delta(sqrt_price, next_sqrt, liquidity, false)
                };
                amount_out += partial_out;
                accumulate_segment_fee(
                    &mut fee_growth_delta_0,
                    &mut fee_growth_delta_1,
                    zero_for_one,
                    amount_remaining,
                    fee_tier,
                    liquidity,
                );
                amount_remaining = 0;
            }
        }

        // Charge only what was actually traded. If the swap stopped early at the
        // price limit, the unconsumed remainder must be refunded (not seized).
        let traded_base = (amount_in - fee_amount) - amount_remaining;
        let fee_on_traded = traded_base * fee_tier as u128 / FEE_DENOMINATOR;
        let input_paid = traded_base + fee_on_traded;

        // Transfer tokens (fee is retained in the pool).
        if zero_for_one {
            token::Client::new(&env, &token_0)
                .transfer(&sender, &env.current_contract_address(), &(input_paid as i128));
            if amount_out > 0 {
                token::Client::new(&env, &token_1)
                    .transfer(&env.current_contract_address(), &sender, &(amount_out as i128));
            }
        } else {
            token::Client::new(&env, &token_1)
                .transfer(&sender, &env.current_contract_address(), &(input_paid as i128));
            if amount_out > 0 {
                token::Client::new(&env, &token_0)
                    .transfer(&env.current_contract_address(), &sender, &(amount_out as i128));
            }
        }

        // Roll the per-segment fee growth into the global accumulators.
        if fee_growth_delta_0 > 0 {
            let fg0: u128 = env
                .storage()
                .instance()
                .get(&DataKey::FeeGrowthGlobal0)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::FeeGrowthGlobal0, &(fg0 + fee_growth_delta_0));
        }
        if fee_growth_delta_1 > 0 {
            let fg1: u128 = env
                .storage()
                .instance()
                .get(&DataKey::FeeGrowthGlobal1)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::FeeGrowthGlobal1, &(fg1 + fee_growth_delta_1));
        }

        env.storage()
            .instance()
            .set(&DataKey::SqrtPriceX96, &sqrt_price);
        env.storage()
            .instance()
            .set(&DataKey::CurrentTick, &sqrt_price_to_tick(sqrt_price));
        env.storage().instance().set(&DataKey::Liquidity, &liquidity);

        let (amount_0_delta, amount_1_delta) = if zero_for_one {
            (input_paid as i128, -(amount_out as i128))
        } else {
            (-(amount_out as i128), input_paid as i128)
        };

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
            .unwrap_or_else(|| panic_pool_error(&env, PoolError::PositionNotFound));

        if position.owner != owner {
            panic_pool_error(&env, PoolError::Unauthorized);
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
            .unwrap_or_else(|| panic_pool_error(&env, PoolError::PositionNotFound));

        if position.owner != owner {
            panic_pool_error(&env, PoolError::Unauthorized);
        }
        if liquidity_to_remove == 0 || liquidity_to_remove > position.liquidity {
            panic_pool_error(&env, PoolError::ZeroLiquidity);
        }

        let tick_spacing: i32 = env
            .storage()
            .instance()
            .get(&DataKey::TickSpacing)
            .unwrap();

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

        // Release the position's contribution from its boundary ticks.
        let lower_flipped =
            update_tick(&env, position.tick_lower, -(liquidity_to_remove as i128), false);
        let upper_flipped =
            update_tick(&env, position.tick_upper, -(liquidity_to_remove as i128), true);
        flip_bitmap(&env, position.tick_lower, tick_spacing, lower_flipped);
        flip_bitmap(&env, position.tick_upper, tick_spacing, upper_flipped);

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
            env.invoke_contract::<()>(
                &nft_contract,
                &Symbol::new(&env, "burn"),
                soroban_sdk::vec![&env, position.nft_id.into_val(&env)],
            );
            env.storage()
                .persistent()
                .remove(&DataKey::Position(position_id));
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::Position(position_id), &position);
            // Update NFT metadata
            env.invoke_contract::<u64>(
                &nft_contract,
                &Symbol::new(&env, "mint"),
                soroban_sdk::vec![
                    &env,
                    owner.into_val(&env),
                    env.current_contract_address().into_val(&env),
                    position.tick_lower.into_val(&env),
                    position.tick_upper.into_val(&env),
                    position.liquidity.into_val(&env),
                ],
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

// ── Tick helpers ──────────────────────────────────────────────────────────────

fn fee_tier_to_tick_spacing(fee_tier: u32) -> i32 {
    match fee_tier {
        500 => 10,
        3000 => 60,
        10_000 => 200,
        _ => 60,
    }
}

fn validate_tick(env: &Env, tick: i32, tick_spacing: i32) {
    if tick < MIN_TICK || tick > MAX_TICK || tick % tick_spacing != 0 {
        panic_pool_error(env, PoolError::InvalidTick);
    }
}

/// Decompose a compressed tick index into (word_pos, bit_pos).
///
/// Words are `u128`, so each word holds 128 compressed tick positions (7 bits of
/// sub-index). Using 7 bits keeps the bit index within `0..128` so `1u128 << bit`
/// never overflows — the sibling `pool` contract used 8 bits with `u128` words,
/// which overflowed on deep/negative ticks.
fn tick_position(compressed: i32) -> (i32, u8) {
    let word_pos = compressed >> 7;
    let bit_pos = (compressed & 0x7F) as u8;
    (word_pos, bit_pos)
}

/// Floor division of `tick` by `tick_spacing`. Required because Rust integer
/// division truncates toward zero, while the tick bitmap expects floor semantics
/// for negative tick indices.
fn compressed_tick(tick: i32, tick_spacing: i32) -> i32 {
    let q = tick / tick_spacing;
    let r = tick % tick_spacing;
    if r < 0 {
        q - 1
    } else {
        q
    }
}

/// Read a tick's liquidity counters, defaulting to an empty tick.
fn read_tick(env: &Env, tick: i32) -> TickInfo {
    let ticks: Option<Map<i32, TickInfo>> = env.storage().instance().get(&DataKey::Ticks);
    ticks
        .and_then(|map| map.get(tick))
        .unwrap_or(TickInfo {
            liquidity_gross: 0,
            liquidity_net: 0,
            fee_growth_outside_0: 0,
            fee_growth_outside_1: 0,
        })
}

fn write_tick(env: &Env, tick: i32, info: &TickInfo) {
    let mut ticks: Map<i32, TickInfo> = env
        .storage()
        .instance()
        .get(&DataKey::Ticks)
        .unwrap_or_else(|| Map::new(env));
    ticks.set(tick, info.clone());
    env.storage().instance().set(&DataKey::Ticks, &ticks);
}

/// Absolute value of a tick's `liquidity_net`, used when rebalancing on cross.
fn net_at_tick(env: &Env, tick: i32) -> u128 {
    let info = read_tick(env, tick);
    if info.liquidity_net < 0 {
        (-info.liquidity_net) as u128
    } else {
        info.liquidity_net as u128
    }
}

/// Update a tick's `liquidity_gross`/`liquidity_net` counters.
/// * `liquidity_delta` - signed liquidity change (positive on mint, negative on burn).
/// * `upper` - `true` at tick_upper (net subtracted), `false` at tick_lower (net added).
///
/// Returns whether the tick's initialized status flipped (0 → nonzero or vice
/// versa), signaling the bitmap bit must be toggled.
fn update_tick(env: &Env, tick: i32, liquidity_delta: i128, upper: bool) -> bool {
    let mut info = read_tick(env, tick);
    let gross_before = info.liquidity_gross;

    let gross_after = if liquidity_delta >= 0 {
        info.liquidity_gross
            .checked_add(liquidity_delta as u128)
            .unwrap_or_else(|| panic_pool_error(env, PoolError::Overflow))
    } else {
        info.liquidity_gross
            .checked_sub((-liquidity_delta) as u128)
            .unwrap_or_else(|| panic_pool_error(env, PoolError::InsufficientLiquidity))
    };
    info.liquidity_gross = gross_after;

    info.liquidity_net = if upper {
        info.liquidity_net
            .checked_sub(liquidity_delta)
            .unwrap_or_else(|| panic_pool_error(env, PoolError::Overflow))
    } else {
        info.liquidity_net
            .checked_add(liquidity_delta)
            .unwrap_or_else(|| panic_pool_error(env, PoolError::Overflow))
    };

    if gross_after == 0 {
        // Fully removed — drop the entry so the running liquidity stays consistent.
        let mut ticks: Map<i32, TickInfo> = env
            .storage()
            .instance()
            .get(&DataKey::Ticks)
            .unwrap_or_else(|| Map::new(env));
        ticks.remove(tick);
        env.storage().instance().set(&DataKey::Ticks, &ticks);
    } else {
        write_tick(env, tick, &info);
    }

    (gross_after == 0) != (gross_before == 0)
}

fn flip_bitmap(env: &Env, tick: i32, tick_spacing: i32, flipped: bool) {
    if !flipped {
        return;
    }
    let compressed = compressed_tick(tick, tick_spacing);
    let (word_pos, bit_pos) = tick_position(compressed);
    let mut bitmap: Map<i32, u128> = env
        .storage()
        .instance()
        .get(&DataKey::Bitmap)
        .unwrap_or_else(|| Map::new(env));
    let word = bitmap.get(word_pos).unwrap_or(0u128);
    let mask = 1u128 << bit_pos;
    bitmap.set(word_pos, word ^ mask);
    env.storage().instance().set(&DataKey::Bitmap, &bitmap);
}

/// Find the next initialized tick in the given direction.
/// * `tick` - starting tick; the search is strict (for `lte=true` strictly
///   below `tick`, for `lte=false` strictly above).
/// * `tick_spacing` - pool spacing.
/// * `lte` - `true` searches toward lower ticks, `false` toward higher ticks.
///
/// Returns `(tick, initialized)`. When no tick is found, returns the boundary
/// (`MIN_TICK`/`MAX_TICK`) with `initialized = false`.
fn next_initialized_tick(env: &Env, tick: i32, tick_spacing: i32, lte: bool) -> (i32, bool) {
    let bitmap: Map<i32, u128> = env
        .storage()
        .instance()
        .get(&DataKey::Bitmap)
        .unwrap_or_else(|| Map::new(env));
    let compressed = compressed_tick(tick, tick_spacing);

    if lte {
        let (word_pos, bit_pos) = tick_position(compressed);
        let mask = (1u128 << bit_pos).wrapping_sub(1).wrapping_add(1u128 << bit_pos);
        let word = bitmap.get(word_pos).unwrap_or(0u128);
        let masked = word & mask;
        if masked != 0 {
            let msb = 127 - masked.leading_zeros() as i32;
            return (((word_pos as i32) * 128 + msb) * tick_spacing, true);
        }
        let mut w = word_pos - 1;
        loop {
            let word = bitmap.get(w).unwrap_or(0u128);
            if word != 0 {
                let msb = 127 - word.leading_zeros() as i32;
                return (((w as i32) * 128 + msb) * tick_spacing, true);
            }
            if w == i32::MIN {
                break;
            }
            w -= 1;
        }
        (MIN_TICK, false)
    } else {
        let (word_pos, bit_pos) = tick_position(compressed + 1);
        let mask = !((1u128 << bit_pos).wrapping_sub(1));
        let word = bitmap.get(word_pos).unwrap_or(0u128);
        let masked = word & mask;
        if masked != 0 {
            let lsb = masked.trailing_zeros() as i32;
            return (((word_pos as i32) * 128 + lsb) * tick_spacing, true);
        }
        let mut w = word_pos + 1;
        loop {
            let word = bitmap.get(w).unwrap_or(0u128);
            if word != 0 {
                let lsb = word.trailing_zeros() as i32;
                return (((w as i32) * 128 + lsb) * tick_spacing, true);
            }
            if w == i32::MAX {
                break;
            }
            w += 1;
        }
        (MAX_TICK, false)
    }
}

/// Cross an initialized tick, flipping its fee-growth-outside accumulators so
/// off-chain fee accounting stays consistent across tick crossings.
fn cross_tick(env: &Env, tick: i32, zero_for_one: bool) {
    let mut info = read_tick(env, tick);
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

    // Flip once per crossing regardless of direction.
    let _ = zero_for_one;
    info.fee_growth_outside_0 = fg0.wrapping_sub(info.fee_growth_outside_0);
    info.fee_growth_outside_1 = fg1.wrapping_sub(info.fee_growth_outside_1);
    write_tick(env, tick, &info);
}

/// Accumulate the fee earned on the input consumed within one segment into the
/// direction-appropriate fee-growth accumulator.
fn accumulate_segment_fee(
    fee_growth_delta_0: &mut u128,
    fee_growth_delta_1: &mut u128,
    zero_for_one: bool,
    amount_in_segment: u128,
    fee_tier: u32,
    liquidity: u128,
) {
    if amount_in_segment == 0 || liquidity == 0 {
        return;
    }
    let fee_amount = amount_in_segment * fee_tier as u128 / FEE_DENOMINATOR;
    if fee_amount == 0 {
        return;
    }
    let growth = fee_amount * Q96 / liquidity;
    if zero_for_one {
        *fee_growth_delta_0 += growth;
    } else {
        *fee_growth_delta_1 += growth;
    }
}

// ── Math helpers ─────────────────────────────────────────────────────────────

/// Approximate tick from sqrt price using log base 1.0001.
///
/// Tick ≈ (sqrt_price_x96 - Q96) * 20000 / Q96. We avoid overflowing `i64` for
/// large price deviations by factoring out `Q96 / 20000` and dividing first.
pub fn sqrt_price_to_tick(sqrt_price_x96: u128) -> i32 {
    if sqrt_price_x96 == 0 {
        return 0;
    }
    let unit = Q96 / 20000; // ≈ magnitude of one tick at price ~1
    let cap = i32::MAX as u128;
    if sqrt_price_x96 >= Q96 {
        ((sqrt_price_x96 - Q96) / unit).min(cap) as i32
    } else {
        let ticks = ((Q96 - sqrt_price_x96) / unit).min(cap) as i32;
        -ticks
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

/// Given the remaining input and the current segment's liquidity, returns the
/// new sqrt price within the segment (does not cross the next tick).
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

/// Amount of token0 between two sqrt prices for a given liquidity.
/// Mirrors `getAmount0Delta` in @swyft/sdk (Uniswap-style) with overflow-safe
/// u128 arithmetic (scaling the sqrt ratio down by Q96 first).
fn get_amount_0_delta(sqrt_a: u128, sqrt_b: u128, liquidity: u128, round_up: bool) -> u128 {
    if sqrt_a == sqrt_b || liquidity == 0 {
        return 0;
    }
    let (lower, upper) = if sqrt_a < sqrt_b {
        (sqrt_a, sqrt_b)
    } else {
        (sqrt_b, sqrt_a)
    };
    if lower == 0 {
        // Boundary case (price at/near zero): treat 1/lower as unbounded.
        return liquidity.saturating_mul(Q96) / upper;
    }
    // amount0 = L * (upper - lower) * Q96 / (upper * lower)
    //         = L * (upper - lower) / ((upper / Q96) * lower)
    let numerator = liquidity.saturating_mul(upper - lower);
    let denominator = (upper / Q96).max(1).saturating_mul(lower);
    let (q, r) = (numerator / denominator, numerator % denominator);
    if round_up && r > 0 {
        q.saturating_add(1)
    } else {
        q
    }
}

/// Amount of token1 between two sqrt prices for a given liquidity.
fn get_amount_1_delta(sqrt_a: u128, sqrt_b: u128, liquidity: u128, round_up: bool) -> u128 {
    if sqrt_a == sqrt_b || liquidity == 0 {
        return 0;
    }
    let (lower, upper) = if sqrt_a < sqrt_b {
        (sqrt_a, sqrt_b)
    } else {
        (sqrt_b, sqrt_a)
    };
    let numerator = liquidity.saturating_mul(upper - lower);
    let (q, r) = (numerator / Q96, numerator % Q96);
    if round_up && r > 0 {
        q.saturating_add(1)
    } else {
        q
    }
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
        panic_pool_error(env, PoolError::NotInitialized);
    }
}

fn panic_pool_error(env: &Env, error: PoolError) -> ! {
    env.panic_with_error(soroban_sdk::Error::from_contract_error(error as u32))
}

#[cfg(test)]
mod fixture_tests {
    use super::tick_to_sqrt_price;

    /// Shared vectors from fixtures/cl-math-vectors.json (tick_to_sqrt_price).
    /// Keep in sync with that file — see packages/sdk/README.md "Math fixture divergence".
    #[test]
    fn tick_to_sqrt_price_matches_shared_fixtures() {
        let vectors: &[(i32, u128)] = &[
            (0, 79228162514264337593543950336),
            (100, 79624303326835659281511670087),
            (-100, 78832021701693015905576230585),
        ];
        assert!(vectors.len() >= 3);
        for &(tick, expected) in vectors {
            assert_eq!(
                tick_to_sqrt_price(tick),
                expected,
                "tick {tick} diverged from fixture"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{get_amount_0_delta, get_amount_1_delta, ClPool, ClPoolClient, Q96};
    use soroban_sdk::{contract, contractimpl, testutils::Address as _, token, Address, Env};

    /// Minimal mock NFT so add/remove liquidity can mint/burn position tokens.
    #[contract]
    pub struct MockNft;

    #[contractimpl]
    impl MockNft {
        pub fn mint(
            _env: Env,
            _owner: Address,
            _pool: Address,
            _lower: i32,
            _upper: i32,
            _liquidity: u128,
        ) -> u64 {
            1
        }
        pub fn burn(_env: Env, _id: u64) {}
    }

    fn create_token(env: &Env, admin: &Address) -> Address {
        env.register_stellar_asset_contract(admin.clone())
    }

    fn mint(env: &Env, id: &Address, to: &Address, amount: u128) {
        token::StellarAssetClient::new(env, id).mint(to, &(amount as i128));
    }

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let lp = Address::generate(&env);
        let swapper = Address::generate(&env);
        let t0 = create_token(&env, &admin);
        let t1 = create_token(&env, &admin);
        let nft = env.register(MockNft, ());
        let pool_id = env.register(ClPool, ());
        let pool = ClPoolClient::new(&env, &pool_id);

        let funding: u128 = 10u128.pow(24);
        mint(&env, &t0, &lp, funding);
        mint(&env, &t1, &lp, funding);
        mint(&env, &t0, &swapper, funding);
        mint(&env, &t1, &swapper, funding);

        pool.initialize(&t0, &t1, &3000u32, &Q96, &nft);
        (env, pool_id, t0, t1, lp, swapper)
    }

    // ── Pure math ───────────────────────────────────────────────────────────

    #[test]
    fn amount_delta_helpers_are_positive_and_order_independent() {
        let liq = 1_000_000_000u128;
        let p_high = Q96;
        let p_low = Q96 - 60u128 * Q96 / 20000;

        let a0_rd = get_amount_0_delta(p_high, p_low, liq, false);
        let a0_ru = get_amount_0_delta(p_high, p_low, liq, true);
        let a1_rd = get_amount_1_delta(p_high, p_low, liq, false);
        let a1_ru = get_amount_1_delta(p_high, p_low, liq, true);

        assert!(a0_rd > 0, "amount0 in must be positive across a tick");
        assert!(a1_rd > 0, "amount1 out must be positive across a tick");
        assert!(a1_rd < liq, "amount1 bounded by liquidity");

        // Swapping sqrt-price argument order must not change the amount.
        assert_eq!(get_amount_0_delta(p_low, p_high, liq, false), a0_rd);
        assert_eq!(get_amount_1_delta(p_low, p_high, liq, false), a1_rd);

        // Round-up (input side) is round-down or one unit above it.
        assert!(a0_ru == a0_rd || a0_ru == a0_rd + 1);
        assert!(a1_ru == a1_rd || a1_ru == a1_rd + 1);

        // Zero liquidity → zero amounts.
        assert_eq!(get_amount_0_delta(p_high, p_low, 0, true), 0);
        assert_eq!(get_amount_1_delta(p_high, p_low, 0, true), 0);
    }

    // ── Tick crossing in swap ───────────────────────────────────────────────

    #[test]
    fn swap_crosses_initialized_tick_and_rebalances_liquidity() {
        let (env, pool_id, _t0, _t1, lp, swapper) = setup();
        let pool = ClPoolClient::new(&env, &pool_id);

        // Position A spans the current price (tick 0), position B sits one
        // spacing below. Both share boundary tick -60:
        //   A: [-60, +60]  liquidity 1_000_000_000  (active now)
        //   B: [-120, -60] liquidity   400_000_000  (dormant below)
        // Crossing -60 rebalances active liquidity from A down to B.
        let liq_a = 1_000_000_000u128;
        let liq_b = 400_000_000u128;

        pool.add_liquidity(&lp, &-60i32, &60i32, &liq_a);
        pool.add_liquidity(&lp, &-120i32, &-60i32, &liq_b);

        // Only range A is in range at tick 0.
        assert_eq!(pool.get_liquidity(), liq_a);

        // token0 → token1 (price decreases). Sized to push past tick -60,
        // then spend a little more inside range B without draining pool token1.
        let (a0, a1) = pool.swap(&swapper, &true, &3_200_000u128, &1u128);
        assert!(a0 > 0, "sender spends token0");
        assert!(a1 < 0, "sender receives token1");

        // Price must have moved down below Q96 (crossed out of range A).
        let price = pool.get_sqrt_price();
        assert!(price < Q96, "price decreased after zero-for-one swap");
        assert!(price > 0);        // The price dropped below tick -60: active liquidity rebalances to B.
        assert_eq!(
            pool.get_liquidity(),
            liq_b,
            "crossing -60 must swap active liquidity from A to B"
        );
    }

    #[test]
    fn swap_rejects_liquidity_when_none_is_in_range() {
        let (env, pool_id, _t0, _t1, lp, swapper) = setup();
        let pool = ClPoolClient::new(&env, &pool_id);
        // Adding only out-of-range liquidity leaves active liquidity at zero.
        pool.add_liquidity(&lp, &120i32, &180i32, &1_000_000_000u128);
        assert_eq!(pool.get_liquidity(), 0);

        let res = pool.try_swap(&swapper, &true, &1_000u128, &1u128);
        assert!(res.is_err(), "swap must fail with zero in-range liquidity");
    }

    #[test]
    fn swap_limit_caps_price_move() {
        let (env, pool_id, _t0, _t1, lp, swapper) = setup();
        let pool = ClPoolClient::new(&env, &pool_id);
        pool.add_liquidity(&lp, &-60i32, &60i32, &1_000_000_000u128);

        // Price limit a bit below current price but inside the active range —
        // the swap must stop at the limit, not cross the -60 tick.
        let limit = Q96 - 30u128 * Q96 / 20000; // sqrt price at ~tick -30
        let (a0, a1) = pool.swap(&swapper, &true, &10_000_000u128, &limit);
        assert!(a0 > 0);
        assert!(a1 < 0);
        // Price must not move below the user's limit.
        assert_eq!(pool.get_sqrt_price(), limit, "price capped at the limit");
        // Liquidity should still be the active range (tick -60 not crossed).
        assert_eq!(pool.get_liquidity(), 1_000_000_000u128);
    }

}