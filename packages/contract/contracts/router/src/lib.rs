#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, symbol_short, Address, Env, Symbol, IntoVal};

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Initialized,
    Factory,
}

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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RouterError {
    NotInitialized = 1,
    DeadlineExpired = 2,
    SlippageExceeded = 3,
    ZeroAmount = 4,
    PoolNotFound = 5,
    EmptyData = 6,
    AlreadyInitialized = 7,
    InvalidPair = 8,
    ExactOutputUnsupported = 9,
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
    /// Return the canonical contract name for the router.
    ///
    /// # Returns
    /// The router contract `Symbol`.
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "router")
    }

    /// Initialize the router with the address of the pool factory contract.
    ///
    /// # Arguments
    /// * `env` — Soroban environment context.
    /// * `factory` — Address of the pool factory contract used to resolve pools.
    ///
    /// # Panics
    /// Panics if the router has already been initialized.
    pub fn initialize(env: Env, factory: Address) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Initialized)
            .unwrap_or(false)
        {
            panic_router(&env, RouterError::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&DataKey::Initialized, &true);
        env.storage()
            .instance()
            .set(&DataKey::Factory, &factory);
    }

    /// Return the current factory contract address stored by the router.
    ///
    /// # Arguments
    /// * `env` — Soroban environment context.
    ///
    /// # Returns
    /// The stored factory contract `Address`.
    ///
    /// # Panics
    /// Panics if the router has not been initialized.
    pub fn get_factory(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Factory)
            .unwrap_or_else(|| panic_router(&env, RouterError::NotInitialized))
    }

    /// Swap an exact amount of `token_in` for at least `amount_out_min` of `token_out`.
    ///
    /// Slippage boundary: the swap succeeds when `amount_out >= amount_out_min`
    /// (exact equality is allowed). It reverts with `RouterError::SlippageExceeded`
    /// when `amount_out < amount_out_min`. The `Swap` event is published only after
    /// the slippage check passes, so under-minOut reverts emit no swap event.
    ///
    /// # Arguments
    /// * `env` — Soroban environment context.
    /// * `params` — Exact input swap parameters.
    ///   * `token_in` — Address of the token to sell.
    ///   * `token_out` — Address of the token to buy.
    ///   * `fee` — Pool fee tier to route through.
    ///   * `recipient` — Address receiving the output tokens.
    ///   * `deadline` — Unix timestamp after which the swap reverts.
    ///   * `amount_in` — Exact amount of input tokens to swap.
    ///   * `amount_out_min` — Minimum acceptable output amount (inclusive boundary).
    ///   * `sqrt_price_limit_x96` — Price limit for the swap.
    ///
    /// # Returns
    /// A `SwapResult` containing the actual input and output amounts.
    pub fn exact_input_single(env: Env, params: ExactInputSingleParams) -> SwapResult {
        check_deadline(&env, params.deadline);
        if params.amount_in == 0 {
            panic_router(&env, RouterError::ZeroAmount);
        }

        // In the concentrated-liquidity model the party that funds the swap is
        // also the recipient of the output (`cl_pool.swap` transfers both legs to
        // and from a single `sender`). `recipient` plays that role here.
        params.recipient.require_auth();

        let pool = get_pool(&env, &params.token_in, &params.token_out, params.fee);
        let (amount_in_used, amount_out) = execute_swap(
            &env,
            &pool,
            &params.recipient,
            &params.token_in,
            &params.token_out,
            params.amount_in,
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
    ///
    /// # Arguments
    /// * `env` — Soroban environment context.
    /// * `params` — Exact output swap parameters.
    ///   * `token_in` — Address of the token to sell.
    ///   * `token_out` — Address of the token to buy.
    ///   * `fee` — Pool fee tier to route through.
    ///   * `recipient` — Address receiving the output tokens.
    ///   * `deadline` — Unix timestamp after which the swap reverts.
    ///   * `amount_out` — Exact amount of output tokens desired.
    ///   * `amount_in_max` — Maximum acceptable input amount.
    ///   * `sqrt_price_limit_x96` — Price limit for the swap.
    ///
    /// # Returns
    /// A `SwapResult` containing the actual input and output amounts.
    pub fn exact_output_single(env: Env, params: ExactOutputSingleParams) -> SwapResult {
        check_deadline(&env, params.deadline);
        if params.amount_out == 0 {
            panic_router(&env, RouterError::ZeroAmount);
        }

        // `cl_pool.swap` is an exact-input-only swap: it consumes a fixed
        // `amount_in` and derives the output from the current tick/liquidity.
        // There is no way to invert that one-way pricing into a requested exact
        // output with a single pool call, so we refuse rather than silently
        // execute a lossy, unrelated swap ("no silent mock success").
        panic_router(&env, RouterError::ExactOutputUnsupported);
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
        .get(&DataKey::Factory)
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

/// Execute a single-hop exact-input swap against the concentrated-liquidity pool.
///
/// Aligns the router's [`SwapResult`] model with the `cl-pool` contract's native
/// `swap(sender, zero_for_one, amount_in, sqrt_price_limit_x96) -> (i128, i128)`
/// interface. The pool reports signed deltas for *both* tokens; we derive the
/// input/output pair from the requested direction:
///
/// * `zero_for_one`  (token_in == token_0): returns `(+amount_in, -amount_out)`,
///   so `amount_in = delta_0` and `amount_out = -delta_1`.
/// * `!zero_for_one` (token_in == token_1): returns `(-amount_out, +amount_in)`,
///   so `amount_in = delta_1` and `amount_out = -delta_0`.
///
/// # Panics
/// Panics with [`RouterError::InvalidPair`] if `token_in`/`token_out` do not
/// exactly match the pool's two tokens.
fn execute_swap(
    env: &Env,
    pool: &Address,
    sender: &Address,
    token_in: &Address,
    token_out: &Address,
    amount: u128,
    sqrt_price_limit_x96: u128,
) -> (u128, u128) {
    let token_0: Address = env.invoke_contract(pool, &Symbol::new(env, "get_token_0"), soroban_sdk::vec![env]);
    let token_1: Address = env.invoke_contract(pool, &Symbol::new(env, "get_token_1"), soroban_sdk::vec![env]);

    let zero_for_one = token_in == &token_0;
    let zero_to_one_valid = zero_for_one && token_out == &token_1;
    let one_to_zero_valid = !zero_for_one && token_in == &token_1 && token_out == &token_0;
    if !zero_to_one_valid && !one_to_zero_valid {
        panic_router(env, RouterError::InvalidPair);
    }

    let (delta_0, delta_1): (i128, i128) = env.invoke_contract(
        pool,
        &Symbol::new(env, "swap"),
        soroban_sdk::vec![
            env,
            sender.into_val(env),
            zero_for_one.into_val(env),
            amount.into_val(env),
            sqrt_price_limit_x96.into_val(env),
        ],
    );

    if zero_for_one {
        let amount_in = u128::try_from(delta_0).expect("token0 delta must be positive");
        let amount_in_neg = delta_1.checked_neg().expect("token1 delta must be negative");
        let amount_out = u128::try_from(amount_in_neg).expect("token1 out must be positive");
        (amount_in, amount_out)
    } else {
        let amount_in = u128::try_from(delta_1).expect("token1 delta must be positive");
        let amount_in_neg = delta_0.checked_neg().expect("token0 delta must be negative");
        let amount_out = u128::try_from(amount_in_neg).expect("token0 out must be positive");
        (amount_in, amount_out)
    }
}

#[cfg(test)]
mod test;
