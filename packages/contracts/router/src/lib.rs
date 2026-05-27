#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RouterError {
    /// The swap deadline has passed.
    DeadlineExpired = 1,
    /// The amount provided is zero or negative.
    InvalidAmount = 2,
    /// The swap path contains fewer than two tokens.
    InvalidPath = 3,
    /// No pool rate has been registered for this token pair.
    PoolNotFound = 4,
    /// The output amount fell below the caller's minimum (slippage).
    SlippageExceeded = 5,
    /// The input amount exceeded the caller's maximum (slippage).
    ExcessiveInput = 6,
    /// An arithmetic overflow occurred during the swap calculation.
    Overflow = 7,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Pool(Address, Address),
}

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted after every successful swap hop.
#[contracttype]
#[derive(Clone)]
pub struct SwapEvent {
    /// Token sold by the caller.
    pub token_in: Address,
    /// Token received by the caller.
    pub token_out: Address,
    /// Exact amount of `token_in` consumed.
    pub amount_in: i128,
    /// Exact amount of `token_out` produced.
    pub amount_out: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    /// Register or update the exchange rate for a token pair.
    ///
    /// # Arguments
    /// * `token_in`  - Address of the input token.
    /// * `token_out` - Address of the output token.
    /// * `rate`      - Units of `token_out` per unit of `token_in`. Must be > 0.
    pub fn set_pool_rate(env: Env, token_in: Address, token_out: Address, rate: i128) {
        if rate <= 0 {
            panic_with_error!(&env, RouterError::InvalidAmount);
        }

        env.storage()
            .instance()
            .set(&DataKey::Pool(token_in, token_out), &rate);
    }

    /// Swap an exact amount of `token_in` for at least `min_amount_out` of `token_out`.
    ///
    /// # Arguments
    /// * `token_in`      - Address of the token being sold.
    /// * `token_out`     - Address of the token being bought.
    /// * `amount_in`     - Exact amount of `token_in` to sell. Must be > 0.
    /// * `min_amount_out`- Minimum acceptable output (slippage guard).
    /// * `deadline`      - Unix timestamp after which the transaction reverts.
    ///
    /// # Returns
    /// The actual amount of `token_out` received.
    pub fn exact_input_single(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(&env, amount_in);

        let amount_out = execute_exact_input_hop(&env, token_in, token_out, amount_in);
        if amount_out < min_amount_out {
            panic_with_error!(&env, RouterError::SlippageExceeded);
        }

        amount_out
    }

    /// Swap at most `max_amount_in` of `token_in` for an exact amount of `token_out`.
    ///
    /// # Arguments
    /// * `token_in`    - Address of the token being sold.
    /// * `token_out`   - Address of the token being bought.
    /// * `amount_out`  - Exact amount of `token_out` desired. Must be > 0.
    /// * `max_amount_in` - Maximum acceptable input (slippage guard).
    /// * `deadline`    - Unix timestamp after which the transaction reverts.
    ///
    /// # Returns
    /// The actual amount of `token_in` consumed.
    pub fn exact_output_single(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_out: i128,
        max_amount_in: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(&env, amount_out);

        let amount_in = quote_exact_output_hop(&env, &token_in, &token_out, amount_out);
        if amount_in > max_amount_in {
            panic_with_error!(&env, RouterError::ExcessiveInput);
        }

        publish_swap(&env, token_in, token_out, amount_in, amount_out);
        amount_in
    }

    /// Swap an exact amount of the first token in `path` for at least `min_amount_out`
    /// of the last token, routing through every consecutive pair in the path.
    ///
    /// # Arguments
    /// * `path`          - Ordered list of token addresses (≥ 2 elements).
    /// * `amount_in`     - Exact amount of `path[0]` to sell. Must be > 0.
    /// * `min_amount_out`- Minimum acceptable amount of `path[last]`.
    /// * `deadline`      - Unix timestamp after which the transaction reverts.
    ///
    /// # Returns
    /// The actual amount of the final token received.
    pub fn exact_input(
        env: Env,
        path: Vec<Address>,
        amount_in: i128,
        min_amount_out: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(&env, amount_in);
        ensure_path(&env, &path);

        let mut amount = amount_in;
        let mut index = 0;

        while index + 1 < path.len() {
            let token_in = path.get(index).unwrap();
            let token_out = path.get(index + 1).unwrap();
            amount = execute_exact_input_hop(&env, token_in, token_out, amount);
            index += 1;
        }

        if amount < min_amount_out {
            panic_with_error!(&env, RouterError::SlippageExceeded);
        }

        amount
    }

    /// Swap at most `max_amount_in` of the first token in `path` for an exact amount
    /// of the last token, routing through every consecutive pair in the path.
    ///
    /// # Arguments
    /// * `path`         - Ordered list of token addresses (≥ 2 elements).
    /// * `amount_out`   - Exact amount of `path[last]` desired. Must be > 0.
    /// * `max_amount_in`- Maximum acceptable amount of `path[0]`.
    /// * `deadline`     - Unix timestamp after which the transaction reverts.
    ///
    /// # Returns
    /// The actual amount of the first token consumed.
    pub fn exact_output(
        env: Env,
        path: Vec<Address>,
        amount_out: i128,
        max_amount_in: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(&env, amount_out);
        ensure_path(&env, &path);

        let mut amount = amount_out;
        let mut index = path.len() - 1;

        while index > 0 {
            let token_in = path.get(index - 1).unwrap();
            let token_out = path.get(index).unwrap();
            let amount_in = quote_exact_output_hop(&env, &token_in, &token_out, amount);
            publish_swap(&env, token_in, token_out, amount_in, amount);
            amount = amount_in;
            index -= 1;
        }

        if amount > max_amount_in {
            panic_with_error!(&env, RouterError::ExcessiveInput);
        }

        amount
    }

    /// Returns the router's balance of `token`. Always 0 — the router is stateless.
    ///
    /// # Arguments
    /// * `_token` - Token address (unused; present for interface compatibility).
    ///
    /// # Returns
    /// `0i128`.
    pub fn get_router_balance(_env: Env, _token: Address) -> i128 {
        0
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn ensure_deadline(env: &Env, deadline: u64) {
    if env.ledger().timestamp() > deadline {
        panic_with_error!(env, RouterError::DeadlineExpired);
    }
}

fn ensure_positive_amount(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, RouterError::InvalidAmount);
    }
}

fn ensure_path(env: &Env, path: &Vec<Address>) {
    if path.len() < 2 {
        panic_with_error!(env, RouterError::InvalidPath);
    }
}

fn execute_exact_input_hop(
    env: &Env,
    token_in: Address,
    token_out: Address,
    amount_in: i128,
) -> i128 {
    let rate = read_pool_rate(env, &token_in, &token_out);
    let amount_out = amount_in
        .checked_mul(rate)
        .unwrap_or_else(|| panic_with_error!(env, RouterError::Overflow));

    publish_swap(env, token_in, token_out, amount_in, amount_out);
    amount_out
}

fn quote_exact_output_hop(
    env: &Env,
    token_in: &Address,
    token_out: &Address,
    amount_out: i128,
) -> i128 {
    let rate = read_pool_rate(env, token_in, token_out);
    div_ceil(amount_out, rate)
}

fn read_pool_rate(env: &Env, token_in: &Address, token_out: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::Pool(token_in.clone(), token_out.clone()))
        .unwrap_or_else(|| panic_with_error!(env, RouterError::PoolNotFound))
}

fn div_ceil(value: i128, divisor: i128) -> i128 {
    (value + divisor - 1) / divisor
}

fn publish_swap(
    env: &Env,
    token_in: Address,
    token_out: Address,
    amount_in: i128,
    amount_out: i128,
) {
    env.events().publish(
        (
            Symbol::new(env, "Swap"),
            token_in.clone(),
            token_out.clone(),
        ),
        SwapEvent {
            token_in,
            token_out,
            amount_in,
            amount_out,
        },
    );
}
