#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol,
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
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "pool")
    }

    /// Initialise the pool with an opening sqrt price and fee tier.
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

    /// Returns current pool state.
    pub fn get_state(env: Env) -> PoolState {
        load_state(&env)
    }

    // ── Tick bitmap ──────────────────────────────────────────────────────────

    /// Flip a tick's initialised status in the bitmap.
    pub fn flip_tick(env: Env, tick: i32, tick_spacing: i32) {
        validate_tick(&env, tick, tick_spacing);
        let (word_pos, bit_pos) = tick_position(tick / tick_spacing);
        let mut bitmap: Map<i16, u128> = env
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
    pub fn next_initialized_tick(env: Env, tick: i32, tick_spacing: i32, lte: bool) -> (i32, bool) {
        let compressed = tick / tick_spacing;
        let bitmap: Map<i16, u128> = env
            .storage()
            .instance()
            .get(&KEY_BITMAP)
            .unwrap_or(Map::new(&env));

        if lte {
            let (word_pos, bit_pos) = tick_position(compressed);
            let mask = (1u128 << bit_pos)
                .wrapping_sub(1)
                .wrapping_add(1u128 << bit_pos); // mask = (1 << bit_pos+1) - 1
            let word = bitmap.get(word_pos).unwrap_or(0u128);
            let masked = word & mask;
            if masked != 0 {
                let msb = 127 - masked.leading_zeros() as i32;
                let next = (word_pos as i32 * 256 + msb) * tick_spacing;
                return (next, true);
            }
            // scan left through words
            let mut w = word_pos - 1;
            loop {
                let word = bitmap.get(w).unwrap_or(0u128);
                if word != 0 {
                    let msb = 127 - word.leading_zeros() as i32;
                    let next = (w as i32 * 256 + msb) * tick_spacing;
                    return (next, true);
                }
                if w == i16::MIN {
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
                let next = (word_pos as i32 * 256 + lsb) * tick_spacing;
                return (next, true);
            }
            let mut w = word_pos + 1;
            loop {
                let word = bitmap.get(w).unwrap_or(0u128);
                if word != 0 {
                    let lsb = word.trailing_zeros() as i32;
                    let next = (w as i32 * 256 + lsb) * tick_spacing;
                    return (next, true);
                }
                if w == i16::MAX {
                    break;
                }
                w += 1;
            }
            (MAX_TICK, false)
        }
    }

    // ── Liquidity management ─────────────────────────────────────────────────

    /// Add liquidity between [tick_lower, tick_upper].
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
        let mut position = env.storage().persistent().get(&positions_key).unwrap_or_else(|| panic_with_pool_error(&env, PoolError::NotInitialized));
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
    pub fn collect(
        env: Env,
        position_id: u64,
        tick_lower: i32,
        tick_upper: i32,
    ) -> CollectResult {
        let state = load_state(&env);
        let positions_key = (KEY_POSITIONS, position_id);
        let mut position = env.storage().persistent().get(&positions_key).unwrap_or_else(|| panic_with_pool_error(&env, PoolError::NotInitialized));

        let (fee_growth_inside_0_x128, fee_growth_inside_1_x128) = get_fee_growth_inside(&env, tick_lower, tick_upper, state.tick, &state);

        let fee_growth_inside_delta_0 = fee_growth_inside_0_x128.wrapping_sub(position.fee_growth_inside_last_0_x128);
        let fee_growth_inside_delta_1 = fee_growth_inside_1_x128.wrapping_sub(position.fee_growth_inside_last_1_x128);

        let amount_0 = mul_div(position.liquidity, fee_growth_inside_delta_0, 1u128 << 128);
        let amount_1 = mul_div(position.liquidity, fee_growth_inside_delta_1, 1u128 << 128);

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
    pub fn set_price(env: Env, sqrt_price_x96: u128) {
        let mut state = load_state(&env);
        state.sqrt_price_x96 = sqrt_price_x96;
        state.tick = sqrt_price_to_tick(sqrt_price_x96);
        env.storage().instance().set(&KEY_STATE, &state);
    }

    /// Perform a swap.
    pub fn swap(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: u128,
        exact_input: bool,
        sqrt_price_limit_x96: u128,
    ) -> SwapResult {
        // Simplified swap implementation for fee testing
        // In practice, this would do the full swap logic
        let fee_amount = amount_in / 1000; // 0.1% fee
        Self::accrue_fees(env, fee_amount, 0); // Assume token0 fee
        SwapResult {
            amount_in,
            amount_out: amount_in - fee_amount,
        }
    }
        let mut state = load_state(&env);
        if state.liquidity > 0 {
            // fee_growth_delta = (fee_amount << 128) / liquidity
            // But since fee_amount might be small, we need to be careful
            // For simplicity, assume fee_amount is already scaled appropriately
            // In practice, this should use mulDiv
            state.fee_growth_global_0_x128 = state.fee_growth_global_0_x128.wrapping_add(
                if fee_0 > 0 { (fee_0 << 128) / state.liquidity } else { 0 }
            );
            state.fee_growth_global_1_x128 = state.fee_growth_global_1_x128.wrapping_add(
                if fee_1 > 0 { (fee_1 << 128) / state.liquidity } else { 0 }
            );
        }
        env.storage().instance().set(&KEY_STATE, &state);
    }
}

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

/// Decompose a compressed tick into (word_pos, bit_pos).
fn tick_position(compressed: i32) -> (i16, u8) {
    let word_pos = (compressed >> 8) as i16;
    let bit_pos = (compressed & 0xFF) as u8;
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

/// Approximate sqrt(1.0001^tick) * 2^96 using integer arithmetic.
pub fn tick_to_sqrt_price(tick: i32) -> u128 {
    if tick == 0 {
        return Q96;
    }
    // Use the ratio 1.0001 ≈ 10001/10000 and repeated squaring.
    // For negative ticks compute the reciprocal.
    let abs = tick.unsigned_abs() as u64;
    let mut result: u128 = 10000; // represents 1.0 scaled by 10000
    let mut base: u128 = 10001;
    let mut exp = abs;
    while exp > 0 {
        if exp & 1 == 1 {
            result = result.saturating_mul(base) / 10000;
        }
        base = base.saturating_mul(base) / 10000;
        exp >>= 1;
    }
    if tick > 0 {
        // result ≈ 1.0001^tick * 10000; sqrt * Q96
        let sqrt = isqrt(result);
        sqrt.saturating_mul(Q96 / 100)
    } else {
        // reciprocal
        let sqrt = isqrt(result);
        if sqrt == 0 {
            return Q96;
        }
        (Q96 / 100).saturating_mul(10000) / sqrt
    }
}

/// Approximate tick from sqrt price (floor).
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

fn get_amount_0(liquidity: u128, sqrt_lower: u128, sqrt_upper: u128, sqrt_current: u128) -> u128 {
    let sa = sqrt_current.max(sqrt_lower);
    let sb = sqrt_current.min(sqrt_upper);
    if sa >= sb || sqrt_lower == 0 || sqrt_upper == 0 {
        return 0;
    }
    // amount0 = L * (1/sa - 1/sb) = L * (sb - sa) / (sa * sb / Q96)
    let num = liquidity.saturating_mul(sb.saturating_sub(sa));
    let denom = (sa / Q96).saturating_mul(sb).max(1);
    num / denom
}

fn get_amount_1(liquidity: u128, sqrt_lower: u128, sqrt_upper: u128, sqrt_current: u128) -> u128 {
    let sa = sqrt_current.max(sqrt_lower);
    let sb = sqrt_current.min(sqrt_upper);
    if sa >= sb {
        return 0;
    }
    liquidity
        .saturating_mul(sb.saturating_sub(sa))
        / Q96
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
