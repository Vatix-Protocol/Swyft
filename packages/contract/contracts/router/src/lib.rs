#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ExactInputSingleParams {
    pub token_in: Address,
    pub token_out: Address,
    pub fee: u32,
    pub recipient: Address,
    pub deadline: u64,
    pub amount_in: u128,
    pub amount_out_min: u128,
    pub sqrt_price_limit_x96: u128,
}

#[contracttype]
#[derive(Clone)]
pub struct ExactOutputSingleParams {
    pub token_in: Address,
    pub token_out: Address,
    pub fee: u32,
    pub recipient: Address,
    pub deadline: u64,
    pub amount_out: u128,
    pub amount_in_max: u128,
    pub sqrt_price_limit_x96: u128,
}

#[contracttype]
#[derive(Clone)]
pub struct SwapResult {
    pub amount_in: u128,
    pub amount_out: u128,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
#[repr(u32)]
pub enum RouterError {
    NotInitialized = 1,
    DeadlineExpired = 2,
    SlippageExceeded = 3,
    ZeroAmount = 4,
    PoolNotFound = 5,
}

impl From<RouterError> for soroban_sdk::Error {
    fn from(e: RouterError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

// ── Pool interface (cross-contract call stubs) ────────────────────────────────

// Minimal pool state we read back after a swap.
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

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "router")
    }

    pub fn initialize(env: Env, factory: Address) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Initialized)
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&DataKey::Initialized, &true);
        env.storage()
            .instance()
            .set(&symbol_short!("factory"), &factory);
    }

    pub fn get_factory(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("factory"))
            .unwrap_or_else(|| panic_router(&env, RouterError::NotInitialized))
    }

    /// Swap an exact amount of `token_in` for at least `amount_out_min` of `token_out`.
    pub fn exact_input_single(env: Env, params: ExactInputSingleParams) -> SwapResult {
        check_deadline(&env, params.deadline);
        if params.amount_in == 0 {
            panic_router(&env, RouterError::ZeroAmount);
        }

        let pool = get_pool(&env, &params.token_in, &params.token_out, params.fee);
        let (amount_in_used, amount_out) = execute_swap(
            &env,
            &pool,
            &params.token_in,
            &params.token_out,
            params.amount_in,
            true,
            params.sqrt_price_limit_x96,
        );

        if amount_out < params.amount_out_min {
            panic_router(&env, RouterError::SlippageExceeded);
        }

        env.events().publish(
            (symbol_short!("Swap"),),
            (
                params.token_in.clone(),
                params.token_out.clone(),
                amount_in_used,
                amount_out,
                params.recipient.clone(),
            ),
        );

        SwapResult {
            amount_in: amount_in_used,
            amount_out,
        }
    }

    /// Swap at most `amount_in_max` of `token_in` for an exact amount of `token_out`.
    pub fn exact_output_single(env: Env, params: ExactOutputSingleParams) -> SwapResult {
        check_deadline(&env, params.deadline);
        if params.amount_out == 0 {
            panic_router(&env, RouterError::ZeroAmount);
        }

        let pool = get_pool(&env, &params.token_in, &params.token_out, params.fee);
        let (amount_in_used, amount_out) = execute_swap(
            &env,
            &pool,
            &params.token_in,
            &params.token_out,
            params.amount_out,
            false,
            params.sqrt_price_limit_x96,
        );

        if amount_in_used > params.amount_in_max {
            panic_router(&env, RouterError::SlippageExceeded);
        }

        env.events().publish(
            (symbol_short!("Swap"),),
            (
                params.token_in.clone(),
                params.token_out.clone(),
                amount_in_used,
                amount_out,
                params.recipient.clone(),
            ),
        );

        SwapResult {
            amount_in: amount_in_used,
            amount_out,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn panic_router(env: &Env, e: RouterError) -> ! {
    env.panic_with_error(soroban_sdk::Error::from_contract_error(e as u32))
}

fn check_deadline(env: &Env, deadline: u64) {
    let now = env.ledger().timestamp();
    if now > deadline {
        panic_router(env, RouterError::DeadlineExpired);
    }
}

/// Resolve the pool address from the factory registry.
fn get_pool(env: &Env, token_in: &Address, token_out: &Address, fee: u32) -> Address {
    let factory: Address = env
        .storage()
        .instance()
        .get(&symbol_short!("factory"))
        .unwrap_or_else(|| panic_router(env, RouterError::NotInitialized));

    // Call factory.get_pool(token_in, token_out, fee) — returns Option<Address>
    let pool: Option<Address> = env.invoke_contract(
        &factory,
        &Symbol::new(env, "get_pool"),
        soroban_sdk::vec![
            env,
            token_in.into_val(env),
            token_out.into_val(env),
            fee.into_val(env),
        ],
    );
    pool.unwrap_or_else(|| panic_router(env, RouterError::PoolNotFound))
}

/// Execute a single-hop swap against the pool contract.
/// `exact_input = true`  → amount is the input, returns (amount_in, amount_out)
/// `exact_input = false` → amount is the desired output, returns (amount_in, amount_out)
fn execute_swap(
    env: &Env,
    pool: &Address,
    token_in: &Address,
    token_out: &Address,
    amount: u128,
    exact_input: bool,
    sqrt_price_limit_x96: u128,
) -> (u128, u128) {
    // Call pool.swap(token_in, token_out, amount, exact_input, sqrt_price_limit_x96)
    let result: SwapResult = env.invoke_contract(
        pool,
        &Symbol::new(env, "swap"),
        soroban_sdk::vec![
            env,
            token_in.into_val(env),
            token_out.into_val(env),
            amount.into_val(env),
            exact_input.into_val(env),
            sqrt_price_limit_x96.into_val(env),
        ],
    );
    (result.amount_in, result.amount_out)
}

#[cfg(test)]
mod test;
