#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Symbol,
};

/// Circular buffer capacity — matches Uniswap v3.
const BUFFER_SIZE: u32 = 65535;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    WindowTooLarge = 4,
    InsufficientHistory = 5,
}

/// A single price observation stored in the circular buffer.
#[contracttype]
#[derive(Clone)]
pub struct Observation {
    /// Ledger timestamp when this observation was recorded.
    pub timestamp: u64,
    /// Cumulative sum of sqrt_price_x96 * elapsed_seconds up to this point.
    pub cumulative_sqrt_price: u128,
    /// Cumulative sum of liquidity * elapsed_seconds up to this point.
    pub cumulative_liquidity: u128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Initialized,
    /// The pool contract authorised to write observations.
    Pool,
    /// Index of the next slot to write (wraps at BUFFER_SIZE).
    WriteIndex,
    /// Total number of observations ever written (capped at BUFFER_SIZE).
    ObservationCount,
    /// Individual observation slot.
    Obs(u32),
}

#[contract]
pub struct OracleAdapter;

#[contractimpl]
impl OracleAdapter {
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "oracle_adapter")
    }

    /// Initialises the adapter.  Only the registered `pool` may write observations.
    pub fn initialize(env: Env, pool: Address) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Initialized)
            .unwrap_or(false)
        {
            panic_with_error!(&env, OracleError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Pool, &pool);
        env.storage().instance().set(&DataKey::WriteIndex, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::ObservationCount, &0u32);
    }

    /// Called by the pool on every swap to record a new observation.
    ///
    /// `sqrt_price_x96` — current pool sqrt price after the swap.
    /// `liquidity`      — current active liquidity after the swap.
    pub fn write_observation(env: Env, sqrt_price_x96: u128, liquidity: u128) {
        ensure_initialized(&env);

        // Only the registered pool may write.
        let pool: Address = env.storage().instance().get(&DataKey::Pool).unwrap();
        pool.require_auth();

        let now = env.ledger().timestamp();
        let write_idx: u32 = env
            .storage()
            .instance()
            .get(&DataKey::WriteIndex)
            .unwrap_or(0);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ObservationCount)
            .unwrap_or(0);

        // Derive cumulative values from the previous observation (if any).
        let (cum_sqrt, cum_liq) = if count == 0 {
            (0u128, 0u128)
        } else {
            let prev_idx = if write_idx == 0 {
                BUFFER_SIZE - 1
            } else {
                write_idx - 1
            };
            let prev: Observation = env
                .storage()
                .persistent()
                .get(&DataKey::Obs(prev_idx))
                .unwrap();
            let elapsed = now.saturating_sub(prev.timestamp) as u128;
            (
                prev.cumulative_sqrt_price
                    .saturating_add(sqrt_price_x96.saturating_mul(elapsed)),
                prev.cumulative_liquidity
                    .saturating_add(liquidity.saturating_mul(elapsed)),
            )
        };

        let obs = Observation {
            timestamp: now,
            cumulative_sqrt_price: cum_sqrt,
            cumulative_liquidity: cum_liq,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Obs(write_idx), &obs);

        let next_idx = (write_idx + 1) % BUFFER_SIZE;
        env.storage()
            .instance()
            .set(&DataKey::WriteIndex, &next_idx);
        env.storage()
            .instance()
            .set(&DataKey::ObservationCount, &count.saturating_add(1).min(BUFFER_SIZE));

        env.events().publish(
            (Symbol::new(&env, "Observation"),),
            (now, sqrt_price_x96, liquidity),
        );
    }

    /// Returns the time-weighted average sqrt price over the last `window_secs` seconds.
    ///
    /// Reverts with `InsufficientHistory` if the buffer does not cover the full window.
    pub fn get_twap(env: Env, window_secs: u64) -> u128 {
        ensure_initialized(&env);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ObservationCount)
            .unwrap_or(0);

        if count < 2 {
            panic_with_error!(&env, OracleError::InsufficientHistory);
        }

        let write_idx: u32 = env
            .storage()
            .instance()
            .get(&DataKey::WriteIndex)
            .unwrap_or(0);

        // Most-recent observation is at (write_idx - 1) mod BUFFER_SIZE.
        let latest_idx = if write_idx == 0 {
            BUFFER_SIZE - 1
        } else {
            write_idx - 1
        };
        let latest: Observation = env
            .storage()
            .persistent()
            .get(&DataKey::Obs(latest_idx))
            .unwrap();

        let target_ts = latest.timestamp.saturating_sub(window_secs);

        // Oldest observation in the buffer.
        let oldest_idx = if count < BUFFER_SIZE {
            0u32
        } else {
            write_idx % BUFFER_SIZE
        };
        let oldest: Observation = env
            .storage()
            .persistent()
            .get(&DataKey::Obs(oldest_idx))
            .unwrap();

        if oldest.timestamp > target_ts {
            panic_with_error!(&env, OracleError::WindowTooLarge);
        }

        // Binary-search for the observation at or just before target_ts.
        let start_obs = binary_search_observation(&env, count, write_idx, target_ts);

        let elapsed = (latest.timestamp - start_obs.timestamp) as u128;
        if elapsed == 0 {
            panic_with_error!(&env, OracleError::InsufficientHistory);
        }

        let cum_delta = latest
            .cumulative_sqrt_price
            .saturating_sub(start_obs.cumulative_sqrt_price);

        cum_delta / elapsed
    }

    pub fn get_pool(env: Env) -> Address {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::Pool).unwrap()
    }

    pub fn get_observation_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ObservationCount)
            .unwrap_or(0)
    }

    /// Returns the observation at a given buffer slot index (0-based, absolute).
    pub fn get_observation(env: Env, index: u32) -> Observation {
        env.storage()
            .persistent()
            .get(&DataKey::Obs(index % BUFFER_SIZE))
            .unwrap()
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) {
    if !env
        .storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
    {
        panic_with_error!(env, OracleError::NotInitialized);
    }
}

/// Binary-searches the circular buffer for the observation whose timestamp is
/// the largest value ≤ `target_ts`.  Returns that observation.
fn binary_search_observation(
    env: &Env,
    count: u32,
    write_idx: u32,
    target_ts: u64,
) -> Observation {
    // The buffer is logically ordered oldest→newest.
    // oldest_pos is the absolute slot of the oldest entry.
    let oldest_pos = if count < BUFFER_SIZE {
        0u32
    } else {
        write_idx % BUFFER_SIZE
    };

    let mut lo: u32 = 0;
    let mut hi: u32 = count - 1;
    let mut result_idx = oldest_pos;

    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        let abs_idx = (oldest_pos + mid) % BUFFER_SIZE;
        let obs: Observation = env
            .storage()
            .persistent()
            .get(&DataKey::Obs(abs_idx))
            .unwrap();

        if obs.timestamp <= target_ts {
            result_idx = abs_idx;
            lo = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        }
    }

    env.storage()
        .persistent()
        .get(&DataKey::Obs(result_idx))
        .unwrap()
}
