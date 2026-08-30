#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Map, Symbol,
};

// ── Constants ────────────────────────────────────────────────────────────────
pub const Q96: u128 = 1u128 << 96;
pub const MIN_TICK: i32 = -887272;
pub const MAX_TICK: i32 = 887272;

// ── Storage keys ─────────────────────────────────────────────────────────────
const KEY_STATE: Symbol = symbol_short!("STATE");
const KEY_TICKS: Symbol = symbol_short!("TICKS");
const KEY_BITMAP: Symbol = symbol_short!("BITMAP");
const KEY_POSITIONS: Symbol = symbol_short!("POSITIONS");
const KEY_ORACLE: Symbol = symbol_short!("ORACLE");

// ── User-facing messages for empty states ────────────────────────────────────
/// Message for empty liquidity pool state.
pub const EMPTY_POOL_MESSAGE: &str = "No liquidity available. Add liquidity to get started.";
/// Message for non-existent or removed position.
pub const EMPTY_POSITION_MESSAGE: &str = "Position does not exist or has been fully removed.";
/// Message for zero liquidity in range.
pub const ZERO_LIQUIDITY_MESSAGE: &str = "Zero liquidity in current range. Add liquidity to continue.";
/// Message for zero accumulated fees.
pub const NO_FEES_MESSAGE: &str = "No accumulated fees to collect.";

// ── Types ────────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone)]
pub struct PoolState {
    pub sqrt_price_x96: u128,
    pub tick: i32,
    pub liquidity: u128,
    pub fee_growth_global_0_x128: u128,
    pub fee_growth_global_1_x128: u128,
    pub fee_tier: u32,
    pub tick_spacing: i32,
    pub token_0: Address,
    pub token_1: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct TickInfo {
    pub liquidity_gross: u128,
    pub liquidity_net: i128,
    pub fee_growth_outside_0_x128: u128,
    pub fee_growth_outside_1_x128: u128,
    pub initialized: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct Position {
    pub liquidity: u128,
    pub fee_growth_inside_last_0_x128: u128,
    pub fee_growth_inside_last_1_x128: u128,
}

#[contracttype]
#[derive(Clone)]
pub struct MintResult {
    pub amount_0: u128,
    pub amount_1: u128,
}

#[contracttype]
#[derive(Clone)]
pub struct BurnResult {
    pub amount_0: u128,
    pub amount_1: u128,
}

#[contracttype]
#[derive(Clone)]
pub struct CollectResult {
    pub amount_0: u128,
    pub amount_1: u128,
}

#[contracttype]
#[derive(Clone)]
pub struct SwapResult {
    pub amount_in: u128,
    pub amount_out: u128,
}

// ── Errors ───────────────────────────────────────────────────────────────────
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum PoolError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidTick = 3,
    InvalidTickRange = 4,
    ZeroLiquidity = 5,
    Overflow = 6,
    InsufficientLiquidity = 7,
    InvalidTickSpacing = 8,
}

impl From<PoolError> for soroban_sdk::Error {
    fn from(e: PoolError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

// ── Contract ─────────────────────────────────────────────────────────────────
#[contract]
pub struct Pool;

#[contractimpl]
impl Pool {
    /// Returns the contract name — used for post-deploy verification.
    ///
    /// # Returns
    /// A `Symbol` with value `"pool"`.
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "pool")
    }

    /// Initialise the pool with an opening sqrt price and fee tier.
    ///
    /// # Arguments
    /// * `token_0` - Address of the first (sorted) token.
    /// * `token_1` - Address of the second (sorted) token.
    /// * `sqrt_price_x96` - Opening square-root price in Q64.96 format.
    /// * `fee_tier` - Fee tier in hundredths of a basis point (e.g. 500 = 0.05 %).
    ///
    /// # Errors
    /// Panics with `PoolError::AlreadyInitialized` if the pool has already been set up.
    pub fn initialize(
        env: Env,
        token_0: Address,
        token_1: Address,
        sqrt_price_x96: u128,
        fee_tier: u32,
    ) {
        if env.storage().instance().has(&KEY_STATE) {
            panic_with_pool_error(&env, PoolError::AlreadyInitialized);
        }
        let tick_spacing = fee_tier_to_tick_spacing(fee_tier);
        let tick = sqrt_price_to_tick(sqrt_price_x96);
        let state = PoolState {
            sqrt_price_x96,
            tick,
            liquidity: 0,
            fee_growth_global_0_x128: 0,
            fee_growth_global_1_x128: 0,
            fee_tier,
            tick_spacing,
            token_0,
            token_1,
        };
        env.storage().instance().set(&KEY_STATE, &state);
        env.events().publish(
            (symbol_short!("init"), symbol_short!("pool")),
            (sqrt_price_x96, tick, fee_tier),
        );
    }

    /// Wires the oracle-adapter instance this pool writes observations to.
    ///
    /// Deploy-time wiring step: the pool records a price observation after
    /// every swap so `get_twap` has real history to answer from. Can be set
    /// once; re-pointing (which would let an attacker redirect the pool's
    /// observation writes) is rejected.
    pub fn set_oracle(env: Env, oracle: Address) {
        match env.storage().instance().get::<_, Address>(&KEY_ORACLE) {
            Some(existing) if existing != oracle => {
                panic_with_pool_error(&env, PoolError::AlreadyInitialized);
            }
            Some(_) => {}
            None => {
                env.storage().instance().set(&KEY_ORACLE, &oracle);
                env.events().publish(
                    (Symbol::new(&env, "OracleSet"),),
                    (oracle,),
                );
            }
        }
    }

    /// Returns the oracle-adapter address this pool writes observations to,
    /// or `None` if no oracle has been wired yet.
    pub fn get_oracle(env: Env) -> Option<Address> {
        env.storage().instance().get(&KEY_ORACLE)
    }

    /// Returns current pool state.
    ///
    /// # Returns
    /// A [`PoolState`] snapshot containing sqrt price, current tick, active liquidity,
    /// global fee accumulators, fee tier, tick spacing, and token addresses.
    ///
    /// # Errors
    /// Panics with `PoolError::NotInitialized` if the pool has not been initialised.
    pub fn get_state(env: Env) -> PoolState {
        load_state(&env)
    }

    // ── Tick bitmap ──────────────────────────────────────────────────────────

    /// Flip a tick's initialised status in the bitmap.
    ///
    /// # Arguments
    /// * `tick` - The tick index to flip. Must be a multiple of `tick_spacing` and
    ///   within `[MIN_TICK, MAX_TICK]`.
    /// * `tick_spacing` - The pool's tick spacing derived from its fee tier.
    ///
    /// # Errors
    /// Panics with `PoolError::InvalidTick` if `tick` is out of range or not aligned.
    pub fn flip_tick(env: Env, tick: i32, tick_spacing: i32) {
        validate_tick(&env, tick, tick_spacing);
        let (word_pos, bit_pos) = tick_position(tick / tick_spacing);
        let mut bitmap: Map<i32, u128> = env
            .storage()
            .instance()
            .get(&KEY_BITMAP)
            .unwrap_or(Map::new(&env));
        let word = bitmap.get(word_pos).unwrap_or(0u128);
        let mask = 1u128 << bit_pos;
        bitmap.set(word_pos, word ^ mask);
        env.storage().instance().set(&KEY_BITMAP, &bitmap);
    }

    /// Find the next initialised tick at or after `tick` in the given direction.
    /// `lte = true` searches left (decreasing), `lte = false` searches right.
    ///
    /// # Arguments
    /// * `tick` - Starting tick index for the search.
    /// * `tick_spacing` - The pool's tick spacing.
    /// * `lte` - Search direction: `true` = towards lower ticks, `false` = towards higher ticks.
    ///
    /// # Returns
    /// A tuple `(next_tick, initialized)` where `initialized` is `false` when no
    /// initialised tick was found and the boundary (`MIN_TICK` / `MAX_TICK`) is returned.
    pub fn next_initialized_tick(env: Env, tick: i32, tick_spacing: i32, lte: bool) -> (i32, bool) {
        let compressed = tick / tick_spacing;
        let bitmap: Map<i32, u128> = env
            .storage()
            .instance()
            .get(&KEY_BITMAP)
            .unwrap_or(Map::new(&env));

        // Valid compressed-tick word range; keeps the scan bounded instead of
        // walking towards i32::MIN / i32::MAX (which blew the VM budget).
        let min_word = (MIN_TICK / tick_spacing) >> 7;
        let max_word = (MAX_TICK / tick_spacing) >> 7;

        if lte {
            let (word_pos, bit_pos) = tick_position(compressed);
            // Bits 0..=bit_pos set: ((1 << bit_pos) - 1) | (1 << bit_pos).
            let mask = (1u128 << bit_pos).wrapping_sub(1) | (1u128 << bit_pos);
            let word = bitmap.get(word_pos).unwrap_or(0u128);
            let masked = word & mask;
            if masked != 0 {
                let msb = 127 - masked.leading_zeros() as i32;
                let next = (word_pos * 128 + msb) * tick_spacing;
                return (next, true);
            }
            // scan left through words
            let mut w = word_pos - 1;
            while w >= min_word {
                let word = bitmap.get(w).unwrap_or(0u128);
                if word != 0 {
                    let msb = 127 - word.leading_zeros() as i32;
                    let next = (w * 128 + msb) * tick_spacing;
                    return (next, true);
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
                let next = (word_pos * 128 + lsb) * tick_spacing;
                return (next, true);
            }
            let mut w = word_pos + 1;
            while w <= max_word {
                let word = bitmap.get(w).unwrap_or(0u128);
                if word != 0 {
                    let lsb = word.trailing_zeros() as i32;
                    let next = (w * 128 + lsb) * tick_spacing;
                    return (next, true);
                }
                w += 1;
            }
            (MAX_TICK, false)
        }
    }

    // ── Liquidity management ─────────────────────────────────────────────────

    /// Add liquidity between [tick_lower, tick_upper].
    ///
    /// Updates tick accumulators, the tick bitmap, active liquidity (when the
    /// current tick is inside the range), and the caller's position record.
    ///
    /// # Arguments
    /// * `position_id` - Unique identifier for the LP position (e.g. NFT token id).
    /// * `tick_lower` - Lower bound of the price range (inclusive, must be aligned to tick spacing).
    /// * `tick_upper` - Upper bound of the price range (exclusive, must be aligned to tick spacing).
    /// * `amount` - Amount of liquidity units to add. Must be > 0.
    ///
    /// # Returns
    /// A [`MintResult`] with the token amounts required to fund the position.
    ///
    /// # Errors
    /// Panics with `PoolError::ZeroLiquidity` if `amount == 0`.
    /// Panics with `PoolError::InvalidTick` if either tick is out of range or misaligned.
    /// Panics with `PoolError::InvalidTickRange` if `tick_lower >= tick_upper`.
    /// Panics with `PoolError::Overflow` on arithmetic overflow.
    pub fn mint(
        env: Env,
        position_id: u64,
        tick_lower: i32,
        tick_upper: i32,
        amount: u128,
    ) -> MintResult {
        if amount == 0 {
            panic_with_pool_error(&env, PoolError::ZeroLiquidity);
        }
        let mut state = load_state(&env);
        validate_tick(&env, tick_lower, state.tick_spacing);
        validate_tick(&env, tick_upper, state.tick_spacing);
        if tick_lower >= tick_upper {
            panic_with_pool_error(&env, PoolError::InvalidTickRange);
        }

        // Update ticks
        let lower_flipped = update_tick(&env, tick_lower, amount as i128, false, &state);
        let upper_flipped = update_tick(&env, tick_upper, amount as i128, true, &state);

        if lower_flipped {
            Self::flip_tick(env.clone(), tick_lower, state.tick_spacing);
        }
        if upper_flipped {
            Self::flip_tick(env.clone(), tick_upper, state.tick_spacing);
        }

        // Update active liquidity if current tick is within range
        if state.tick >= tick_lower && state.tick < tick_upper {
            state.liquidity = state
                .liquidity
                .checked_add(amount)
                .unwrap_or_else(|| panic_with_pool_error(&env, PoolError::Overflow));
        }

        // Update or create position
        let (fee_growth_inside_0_x128, fee_growth_inside_1_x128) = get_fee_growth_inside(&env, tick_lower, tick_upper, state.tick, &state);
        
        let positions_key = (KEY_POSITIONS, position_id);
        let mut position = env.storage().persistent().get(&positions_key).unwrap_or(Position {
            liquidity: 0,
            fee_growth_inside_last_0_x128: fee_growth_inside_0_x128,
            fee_growth_inside_last_1_x128: fee_growth_inside_1_x128,
        });
        position.liquidity = position.liquidity.checked_add(amount).unwrap_or_else(|| panic_with_pool_error(&env, PoolError::Overflow));
        env.storage().persistent().set(&positions_key, &position);

        let sqrt_lower = tick_to_sqrt_price(tick_lower);
        let sqrt_upper = tick_to_sqrt_price(tick_upper);
        let amount_0 = get_amount_0(amount, sqrt_lower, sqrt_upper, state.sqrt_price_x96);
        let amount_1 = get_amount_1(amount, sqrt_lower, sqrt_upper, state.sqrt_price_x96);

        env.storage().instance().set(&KEY_STATE, &state);
        env.events().publish(
            (symbol_short!("mint"),),
            (position_id, tick_lower, tick_upper, amount, amount_0, amount_1),
        );
        MintResult { amount_0, amount_1 }
    }

    /// Remove liquidity between [tick_lower, tick_upper].
    ///
    /// Decrements tick accumulators, updates the bitmap, reduces active liquidity
    /// when the current tick is inside the range, and shrinks or removes the position.
    ///
    /// # Arguments
    /// * `position_id` - Unique identifier for the LP position.
    /// * `tick_lower` - Lower bound of the price range.
    /// * `tick_upper` - Upper bound of the price range.
    /// * `amount` - Amount of liquidity units to remove. Must be > 0.
    ///
    /// # Returns
    /// A [`BurnResult`] with the token amounts released by the position.
    ///
    /// # Errors
    /// Panics with `PoolError::ZeroLiquidity` if `amount == 0`.
    /// Panics with `PoolError::NotInitialized` if the position does not exist.
    /// Panics with `PoolError::InsufficientLiquidity` if `amount` exceeds position liquidity.
    pub fn burn(
        env: Env,
        position_id: u64,
        tick_lower: i32,
        tick_upper: i32,
        amount: u128,
    ) -> BurnResult {
        if amount == 0 {
            panic_with_pool_error(&env, PoolError::ZeroLiquidity);
        }
        let mut state = load_state(&env);
        validate_tick(&env, tick_lower, state.tick_spacing);
        validate_tick(&env, tick_upper, state.tick_spacing);
        if tick_lower >= tick_upper {
            panic_with_pool_error(&env, PoolError::InvalidTickRange);
        }

        let lower_flipped = update_tick(&env, tick_lower, -(amount as i128), false, &state);
        let upper_flipped = update_tick(&env, tick_upper, -(amount as i128), true, &state);

        if lower_flipped {
            Self::flip_tick(env.clone(), tick_lower, state.tick_spacing);
        }
        if upper_flipped {
            Self::flip_tick(env.clone(), tick_upper, state.tick_spacing);
        }

        if state.tick >= tick_lower && state.tick < tick_upper {
            state.liquidity = state
                .liquidity
                .checked_sub(amount)
                .unwrap_or_else(|| panic_with_pool_error(&env, PoolError::InsufficientLiquidity));
        }

        // Update position
        let positions_key = (KEY_POSITIONS, position_id);
        let mut position: Position = env.storage().persistent().get(&positions_key).unwrap_or_else(|| panic_with_pool_error(&env, PoolError::NotInitialized));
        position.liquidity = position.liquidity.checked_sub(amount).unwrap_or_else(|| panic_with_pool_error(&env, PoolError::InsufficientLiquidity));
        if position.liquidity == 0 {
            env.storage().persistent().remove(&positions_key);
        } else {
            env.storage().persistent().set(&positions_key, &position);
        }

        let sqrt_lower = tick_to_sqrt_price(tick_lower);
        let sqrt_upper = tick_to_sqrt_price(tick_upper);
        let amount_0 = get_amount_0(amount, sqrt_lower, sqrt_upper, state.sqrt_price_x96);
        let amount_1 = get_amount_1(amount, sqrt_lower, sqrt_upper, state.sqrt_price_x96);

        env.storage().instance().set(&KEY_STATE, &state);
        env.events().publish(
            (symbol_short!("burn"),),
            (position_id, tick_lower, tick_upper, amount, amount_0, amount_1),
        );
        BurnResult { amount_0, amount_1 }
    }

    /// Collect accumulated fees for a position.
    ///
    /// Computes the fee growth inside the position's tick range since the last
    /// collection and transfers the owed amounts to the caller.
    ///
    /// # Arguments
    /// * `position_id` - Unique identifier for the LP position.
    /// * `tick_lower` - Lower bound of the position's price range.
    /// * `tick_upper` - Upper bound of the position's price range.
    ///
    /// # Returns
    /// A [`CollectResult`] with the token amounts collected as fees.
    /// Returns zeroed result (0, 0) if the position does not exist.
    pub fn collect(
        env: Env,
        position_id: u64,
        tick_lower: i32,
        tick_upper: i32,
    ) -> CollectResult {
        let state = match env.storage().instance().get::<_, PoolState>(&KEY_STATE) {
            Some(s) => s,
            None => return CollectResult { amount_0: 0, amount_1: 0 }, // Pool not initialized
        };

        let positions_key = (KEY_POSITIONS, position_id);
        let mut position: Position = match env.storage().persistent().get(&positions_key) {
            Some(p) => p,
            None => return CollectResult { amount_0: 0, amount_1: 0 }, // Position doesn't exist
        };

        let (fee_growth_inside_0_x128, fee_growth_inside_1_x128) = get_fee_growth_inside(&env, tick_lower, tick_upper, state.tick, &state);

        let fee_growth_inside_delta_0 = fee_growth_inside_0_x128.wrapping_sub(position.fee_growth_inside_last_0_x128);
        let fee_growth_inside_delta_1 = fee_growth_inside_1_x128.wrapping_sub(position.fee_growth_inside_last_1_x128);

        let amount_0 = position.liquidity.checked_mul(fee_growth_inside_delta_0).unwrap_or(0);
        let amount_1 = position.liquidity.checked_mul(fee_growth_inside_delta_1).unwrap_or(0);

        position.fee_growth_inside_last_0_x128 = fee_growth_inside_0_x128;
        position.fee_growth_inside_last_1_x128 = fee_growth_inside_1_x128;
        env.storage().persistent().set(&positions_key, &position);

        env.events().publish(
            (symbol_short!("collect"),),
            (position_id, amount_0, amount_1),
        );
        CollectResult { amount_0, amount_1 }
    }

    /// Cross a tick boundary during a swap, updating active liquidity.
    ///
    /// Applies the tick's `liquidity_net` to the pool's active liquidity and
    /// flips the tick's fee-growth-outside accumulators.
    ///
    /// # Arguments
    /// * `tick` - The tick index being crossed.
    /// * `zero_for_one` - Swap direction: `true` = token0 → token1 (price decreasing).
    pub fn cross_tick(env: Env, tick: i32, zero_for_one: bool) {
        let mut state = load_state(&env);
        let mut ticks: Map<i32, TickInfo> = env
            .storage()
            .instance()
            .get(&KEY_TICKS)
            .unwrap_or(Map::new(&env));
        if let Some(mut info) = ticks.get(tick) {
            if zero_for_one {
                state.liquidity = if info.liquidity_net < 0 {
                    state
                        .liquidity
                        .saturating_sub((-info.liquidity_net) as u128)
                } else {
                    state.liquidity.saturating_add(info.liquidity_net as u128)
                };
            } else {
                state.liquidity = if info.liquidity_net >= 0 {
                    state.liquidity.saturating_add(info.liquidity_net as u128)
                } else {
                    state
                        .liquidity
                        .saturating_sub((-info.liquidity_net) as u128)
                };
            }

            // Update fee_growth_outside when crossing
            info.fee_growth_outside_0_x128 = state.fee_growth_global_0_x128.wrapping_sub(info.fee_growth_outside_0_x128);
            info.fee_growth_outside_1_x128 = state.fee_growth_global_1_x128.wrapping_sub(info.fee_growth_outside_1_x128);
            ticks.set(tick, info);
            env.storage().instance().set(&KEY_TICKS, &ticks);
        }
        env.storage().instance().set(&KEY_STATE, &state);
        env.events()
            .publish((symbol_short!("cross"),), (tick, zero_for_one));
    }

    /// Update sqrt price and current tick after a swap step.
    ///
    /// # Arguments
    /// * `sqrt_price_x96` - New square-root price in Q64.96 format.
    pub fn set_price(env: Env, sqrt_price_x96: u128) {
        let mut state = load_state(&env);
        state.sqrt_price_x96 = sqrt_price_x96;
        state.tick = sqrt_price_to_tick(sqrt_price_x96);
        env.storage().instance().set(&KEY_STATE, &state);
    }

    /// Perform a swap.
    ///
    /// Executes a single-hop exact-input swap within this pool, accruing
    /// protocol fees, moving the pool price along the active-liquidity curve,
    /// and recording a post-swap observation with the oracle adapter (when one
    /// is wired) so TWAP queries reflect real on-chain price history.
    ///
    /// # Arguments
    /// * `token_in` - Address of the token being sold.
    /// * `token_out` - Address of the token being bought.
    /// * `amount_in` - Exact amount of `token_in` to swap.
    /// * `exact_input` - Reserved; this implementation is exact-input only.
    /// * `sqrt_price_limit_x96` - Price limit in Q64.96 format; swap stops if this price is reached.
    ///
    /// # Returns
    /// A [`SwapResult`] with the input amount consumed and the output amount returned.
    pub fn swap(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: u128,
        exact_input: bool,
        sqrt_price_limit_x96: u128,
    ) -> SwapResult {
        let _ = (exact_input, token_out);
        let mut state = load_state(&env);

        let fee_amount = amount_in / 1000; // 0.1% fee
        let amount_after_fee = amount_in.saturating_sub(fee_amount);
        let zero_for_one = token_in == state.token_0;

        let mut new_price = next_sqrt_price_from_input(
            state.sqrt_price_x96,
            state.liquidity,
            amount_after_fee,
            zero_for_one,
        );
        // Respect the caller's price limit (0 = no limit for the buying side).
        if zero_for_one {
            if new_price < sqrt_price_limit_x96 {
                new_price = sqrt_price_limit_x96;
            }
        } else if new_price > sqrt_price_limit_x96 {
            new_price = sqrt_price_limit_x96;
        }

        let amount_out = if zero_for_one {
            get_amount_1_out(state.liquidity, new_price, state.sqrt_price_x96)
        } else {
            get_amount_0_out(state.liquidity, state.sqrt_price_x96, new_price)
        };

        state.sqrt_price_x96 = new_price;
        state.tick = sqrt_price_to_tick(new_price);
        env.storage().instance().set(&KEY_STATE, &state);

        Self::accrue_fees(env.clone(), fee_amount, 0); // token0 fee

        // Record the post-swap observation with the oracle adapter (if wired).
        // Failing loudly here — rather than skipping — keeps the TWAP honest:
        // a wired oracle must never silently miss a swap. Raw cross-contract
        // invoke keeps the oracle-adapter out of this crate's wasm (its `name`
        // export would collide with ours at link time).
        if let Some(oracle) = env.storage().instance().get::<_, Address>(&KEY_ORACLE) {
            env.invoke_contract::<()>(
                &oracle,
                &Symbol::new(&env, "write_observation"),
                soroban_sdk::vec![
                    &env,
                    new_price.into_val(&env),
                    state.liquidity.into_val(&env),
                ],
            );
        }

        SwapResult {
            amount_in,
            amount_out,
        }
    }

    /// Update global fee growth accumulators for collected protocol fees.
    ///
    /// # Arguments
    /// * `fee_0` - Protocol fee amount collected in token0 units.
    /// * `fee_1` - Protocol fee amount collected in token1 units.
    fn accrue_fees(env: Env, fee_0: u128, fee_1: u128) {
        let mut state = load_state(&env);
        if state.liquidity > 0 {
            if fee_0 > 0 && state.liquidity > 0 {
                let fee_growth = fee_0 / state.liquidity;
                state.fee_growth_global_0_x128 = state.fee_growth_global_0_x128.wrapping_add(fee_growth);
            }
            if fee_1 > 0 && state.liquidity > 0 {
                let fee_growth = fee_1 / state.liquidity;
                state.fee_growth_global_1_x128 = state.fee_growth_global_1_x128.wrapping_add(fee_growth);
            }
        }
        env.storage().instance().set(&KEY_STATE, &state);
    }
}

#[cfg(test)]
mod test;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn load_state(env: &Env) -> PoolState {
    env.storage()
        .instance()
        .get(&KEY_STATE)
        .unwrap_or_else(|| panic_with_pool_error(env, PoolError::NotInitialized))
}

fn panic_with_pool_error(env: &Env, e: PoolError) -> ! {
    env.panic_with_error(soroban_sdk::Error::from_contract_error(e as u32))
}

fn fee_tier_to_tick_spacing(fee_tier: u32) -> i32 {
    match fee_tier {
        500 => 10,
        3000 => 60,
        10000 => 200,
        _ => 60,
    }
}

fn mul_div(a: u128, b: u128, denominator: u128) -> u128 {
    if denominator == 0 {
        return 0;
    }
    a.checked_mul(b)
        .and_then(|product| product.checked_div(denominator))
        .unwrap_or(0)
}

/// Decompose a compressed tick into (word_pos, bit_pos) for 128-bit words.
///
/// The bitmap stores one 128-bit word per 128 compressed ticks, so a word
/// holds compressed ticks [word*128, word*128 + 127]. This keeps the bit
/// shift inside `0..128` — the previous `& 0xFF` (256 per word) panicked with
/// "attempt to shift left with overflow" for any negative tick.
fn tick_position(compressed: i32) -> (i32, u8) {
    let word_pos = compressed >> 7;
    let bit_pos = (compressed & 0x7F) as u8;
    (word_pos, bit_pos)
}

fn validate_tick(env: &Env, tick: i32, tick_spacing: i32) {
    if tick < MIN_TICK || tick > MAX_TICK || tick % tick_spacing != 0 {
        panic_with_pool_error(env, PoolError::InvalidTick);
    }
}

/// Update a tick's liquidity counters; returns true if the tick was flipped
/// (initialised → uninitialised or vice-versa).
fn update_tick(env: &Env, tick: i32, liquidity_delta: i128, upper: bool, state: &PoolState) -> bool {
    let mut ticks: Map<i32, TickInfo> = env
        .storage()
        .instance()
        .get(&KEY_TICKS)
        .unwrap_or(Map::new(env));

    let mut info = ticks.get(tick).unwrap_or(TickInfo {
        liquidity_gross: 0,
        liquidity_net: 0,
        fee_growth_outside_0_x128: 0,
        fee_growth_outside_1_x128: 0,
        initialized: false,
    });

    let gross_before = info.liquidity_gross;
    let gross_after = if liquidity_delta >= 0 {
        info.liquidity_gross
            .checked_add(liquidity_delta as u128)
            .unwrap_or_else(|| panic_with_pool_error(env, PoolError::Overflow))
    } else {
        info.liquidity_gross
            .checked_sub((-liquidity_delta) as u128)
            .unwrap_or_else(|| panic_with_pool_error(env, PoolError::InsufficientLiquidity))
    };

    info.liquidity_gross = gross_after;
    info.liquidity_net = if upper {
        info.liquidity_net
            .checked_sub(liquidity_delta)
            .unwrap_or_else(|| panic_with_pool_error(env, PoolError::Overflow))
    } else {
        info.liquidity_net
            .checked_add(liquidity_delta)
            .unwrap_or_else(|| panic_with_pool_error(env, PoolError::Overflow))
    };

    // Initialise fee tracking when tick first becomes active
    if gross_before == 0 && gross_after > 0 {
        info.initialized = true;
        if tick <= state.tick {
            info.fee_growth_outside_0_x128 = state.fee_growth_global_0_x128;
            info.fee_growth_outside_1_x128 = state.fee_growth_global_1_x128;
        }
    }
    if gross_after == 0 {
        info.initialized = false;
    }

    let flipped = (gross_after == 0) != (gross_before == 0);
    ticks.set(tick, info);
    env.storage().instance().set(&KEY_TICKS, &ticks);
    flipped
}

/// Compute the next sqrt price given an exact input amount, using the active
/// liquidity. Mirrors the constant-product curve of the CL pool.
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

/// Approximate sqrt(1.0001^tick) * 2^96 using integer arithmetic.
///
/// Computes 1.0001^|tick| at 1e12 fixed-point scale and takes the integer
/// square root, which yields ~6 decimal digits of precision. The previous
/// 1e4 scale floored small ticks to the same value (e.g. ticks 0..≈200 all
/// mapped to Q96), so `sqrt_price_to_tick(Q96)` returned ~199 instead of 0.
///
/// # Arguments
/// * `tick` - Tick index in the range `[MIN_TICK, MAX_TICK]`.
///
/// # Returns
/// The square-root price corresponding to `tick` in Q64.96 format.
pub fn tick_to_sqrt_price(tick: i32) -> u128 {
    if tick == 0 {
        return Q96;
    }
    // Use the ratio 1.0001 ≈ 10001/10000 and repeated squaring at 1e12 scale.
    // For negative ticks compute the reciprocal.
    const SCALE: u128 = 1_000_000_000_000;
    let abs = tick.unsigned_abs() as u64;
    let mut result: u128 = SCALE; // represents 1.0
    let mut base: u128 = 10001 * SCALE / 10000; // ≈ 1.0001
    let mut exp = abs;
    while exp > 0 {
        if exp & 1 == 1 {
            result = result.saturating_mul(base) / SCALE;
        }
        base = base.saturating_mul(base) / SCALE;
        exp >>= 1;
    }
    // result ≈ 1.0001^abs at 1e12 scale; sqrt ≈ 1.00005^abs at 1e6 scale.
    let sqrt = isqrt(result);
    if tick > 0 {
        sqrt.saturating_mul(Q96 / 1_000_000)
    } else {
        // reciprocal: Q96 * 1.00005^(-abs)
        if sqrt == 0 {
            return Q96;
        }
        Q96.saturating_mul(1_000_000) / sqrt
    }
}

/// Approximate tick from sqrt price (floor).
///
/// Uses binary search over `[MIN_TICK, MAX_TICK]` to find the greatest tick
/// whose sqrt price does not exceed `sqrt_price_x96`.
///
/// # Arguments
/// * `sqrt_price_x96` - Square-root price in Q64.96 format.
///
/// # Returns
/// The floor tick index. Returns `MIN_TICK` when `sqrt_price_x96` is zero.
pub fn sqrt_price_to_tick(sqrt_price_x96: u128) -> i32 {
    if sqrt_price_x96 == 0 {
        return MIN_TICK;
    }
    // log base 1.00005 of (sqrt_price / Q96)
    // tick ≈ log(price) / log(1.0001) = 2 * log(sqrt_price/Q96) / log(1.0001)
    // Approximate with binary search over [-887272, 887272]
    let mut lo: i32 = MIN_TICK;
    let mut hi: i32 = MAX_TICK;
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if tick_to_sqrt_price(mid) <= sqrt_price_x96 {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    lo
}

fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Token0 required for `liquidity` in `[sqrt_lower, sqrt_upper]` given the
/// current price, using the standard Uniswap v3 formulas:
///   above range: 0
///   in range:    L * (1/sqrt_current - 1/sqrt_upper)
///   below range: L * (1/sqrt_lower  - 1/sqrt_upper)
fn get_amount_0(liquidity: u128, sqrt_lower: u128, sqrt_upper: u128, sqrt_current: u128) -> u128 {
    if sqrt_current >= sqrt_upper || sqrt_lower == 0 || sqrt_upper == 0 {
        return 0;
    }
    let sa = sqrt_current.max(sqrt_lower);
    let term1 = liquidity.saturating_mul(Q96) / sa;
    let term2 = liquidity.saturating_mul(Q96) / sqrt_upper;
    term1.saturating_sub(term2)
}

/// Token1 required for `liquidity` in `[sqrt_lower, sqrt_upper]` given the
/// current price:
///   below range: 0
///   in range:    L * (sqrt_current - sqrt_lower)
///   above range: L * (sqrt_upper   - sqrt_lower)
fn get_amount_1(liquidity: u128, sqrt_lower: u128, sqrt_upper: u128, sqrt_current: u128) -> u128 {
    if sqrt_current <= sqrt_lower {
        return 0;
    }
    let sb = sqrt_current.min(sqrt_upper);
    liquidity.saturating_mul(sb.saturating_sub(sqrt_lower)) / Q96
}

fn get_fee_growth_inside(env: &Env, tick_lower: i32, tick_upper: i32, tick_current: i32, state: &PoolState) -> (u128, u128) {
    let ticks: Map<i32, TickInfo> = env
        .storage()
        .instance()
        .get(&KEY_TICKS)
        .unwrap_or(Map::new(env));

    let lower = ticks.get(tick_lower).unwrap_or(TickInfo {
        liquidity_gross: 0,
        liquidity_net: 0,
        fee_growth_outside_0_x128: 0,
        fee_growth_outside_1_x128: 0,
        initialized: false,
    });
    let upper = ticks.get(tick_upper).unwrap_or(TickInfo {
        liquidity_gross: 0,
        liquidity_net: 0,
        fee_growth_outside_0_x128: 0,
        fee_growth_outside_1_x128: 0,
        initialized: false,
    });

    let fee_growth_below_0: u128;
    let fee_growth_below_1: u128;
    if tick_current >= tick_lower {
        fee_growth_below_0 = lower.fee_growth_outside_0_x128;
        fee_growth_below_1 = lower.fee_growth_outside_1_x128;
    } else {
        fee_growth_below_0 = state.fee_growth_global_0_x128.wrapping_sub(lower.fee_growth_outside_0_x128);
        fee_growth_below_1 = state.fee_growth_global_1_x128.wrapping_sub(lower.fee_growth_outside_1_x128);
    }

    let fee_growth_above_0: u128;
    let fee_growth_above_1: u128;
    if tick_current < tick_upper {
        fee_growth_above_0 = upper.fee_growth_outside_0_x128;
        fee_growth_above_1 = upper.fee_growth_outside_1_x128;
    } else {
        fee_growth_above_0 = state.fee_growth_global_0_x128.wrapping_sub(upper.fee_growth_outside_0_x128);
        fee_growth_above_1 = state.fee_growth_global_1_x128.wrapping_sub(upper.fee_growth_outside_1_x128);
    }

    (
        state.fee_growth_global_0_x128
            .wrapping_sub(fee_growth_below_0)
            .wrapping_sub(fee_growth_above_0),
        state.fee_growth_global_1_x128
            .wrapping_sub(fee_growth_below_1)
            .wrapping_sub(fee_growth_above_1),
    )
}
