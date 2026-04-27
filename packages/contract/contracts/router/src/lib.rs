#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RouterError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    DeadlineExpired = 3,
    TooLittleReceived = 4,
    TooMuchRequested = 5,
    InvalidPath = 6,
    PoolNotFound = 7,
}

/// A single hop in a multi-hop path: the input token and the fee tier of the
/// pool that connects it to the next token in the path.
#[contracttype]
#[derive(Clone)]
pub struct Hop {
    pub token_in: Address,
    pub fee_tier: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Initialized,
    Factory,
}

// Minimal client stubs for cross-contract calls.
mod pool_factory {
    use soroban_sdk::{contractclient, Address, Env};
    #[contractclient(name = "PoolFactoryClient")]
    pub trait PoolFactory {
        fn get_pool(
            env: Env,
            token_a: Address,
            token_b: Address,
            fee_tier: u32,
        ) -> Option<Address>;
    }
}

mod cl_pool {
    use soroban_sdk::{contractclient, Address, Env};
    #[contractclient(name = "ClPoolClient")]
    pub trait ClPool {
        fn swap(
            env: Env,
            sender: Address,
            zero_for_one: bool,
            amount_in: u128,
            sqrt_price_limit_x96: u128,
        ) -> (i128, i128);
        fn get_sqrt_price(env: Env) -> u128;
    }
}

use cl_pool::ClPoolClient;
use pool_factory::PoolFactoryClient;

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
            .set(&DataKey::Factory, &factory);
    }

    pub fn get_factory(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Factory)
            .unwrap()
    }

    /// Executes a multi-hop exact-input swap.
    ///
    /// `hops`       — ordered list of (token_in, fee_tier) for each pool hop.
    /// `token_out`  — the final output token.
    /// `amount_in`  — exact amount of the first token to spend.
    /// `amount_out_min` — minimum acceptable output (slippage protection).
    /// `recipient`  — address that receives the final output.
    /// `deadline`   — ledger timestamp after which the tx reverts.
    ///
    /// Returns the total output amount received.
    pub fn exact_input(
        env: Env,
        sender: Address,
        hops: Vec<Hop>,
        token_out: Address,
        amount_in: u128,
        amount_out_min: u128,
        recipient: Address,
        deadline: u64,
    ) -> u128 {
        sender.require_auth();
        ensure_initialized(&env);
        check_deadline(&env, deadline);

        if hops.is_empty() || hops.len() > 3 {
            panic_with_error!(&env, RouterError::InvalidPath);
        }

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let factory_client = PoolFactoryClient::new(&env, &factory);

        let mut current_amount = amount_in;
        let n = hops.len();

        for i in 0..n {
            let hop = hops.get(i).unwrap();
            let next_token = if i + 1 < n {
                hops.get(i + 1).unwrap().token_in.clone()
            } else {
                token_out.clone()
            };

            let pool_addr = factory_client
                .get_pool(&hop.token_in, &next_token, &hop.fee_tier)
                .unwrap_or_else(|| panic_with_error!(&env, RouterError::PoolNotFound));

            let pool = ClPoolClient::new(&env, &pool_addr);

            // Determine swap direction: token_in < next_token means zero_for_one
            let zero_for_one = is_token0(&hop.token_in, &next_token);

            // For intermediate hops the router is the transient recipient;
            // tokens flow directly pool-to-pool via transfer calls inside swap.
            let swap_sender = if i == 0 {
                sender.clone()
            } else {
                env.current_contract_address()
            };

            let sqrt_limit = if zero_for_one { 1u128 } else { u128::MAX };
            let (delta0, delta1) =
                pool.swap(&swap_sender, &zero_for_one, &current_amount, &sqrt_limit);

            let out = if zero_for_one {
                (-delta1) as u128
            } else {
                (-delta0) as u128
            };

            env.events().publish(
                (Symbol::new(&env, "Swap"),),
                (
                    hop.token_in.clone(),
                    next_token.clone(),
                    hop.fee_tier,
                    current_amount,
                    out,
                ),
            );

            current_amount = out;
        }

        if current_amount < amount_out_min {
            panic_with_error!(&env, RouterError::TooLittleReceived);
        }

        // Transfer final output to recipient if it ended up in the router.
        if n > 1 {
            token::Client::new(&env, &token_out).transfer(
                &env.current_contract_address(),
                &recipient,
                &(current_amount as i128),
            );
        }

        current_amount
    }

    /// Executes a multi-hop exact-output swap.
    ///
    /// `hops`      — ordered list of (token_in, fee_tier) for each pool hop
    ///               (same order as exact_input, i.e. from token_in to token_out).
    /// `token_out` — the final output token.
    /// `amount_out` — exact amount of the final token to receive.
    /// `amount_in_max` — maximum input the caller is willing to spend (slippage protection).
    /// `recipient`  — address that receives the final output.
    /// `deadline`   — ledger timestamp after which the tx reverts.
    ///
    /// Returns the total input amount spent.
    pub fn exact_output(
        env: Env,
        sender: Address,
        hops: Vec<Hop>,
        token_out: Address,
        amount_out: u128,
        amount_in_max: u128,
        recipient: Address,
        deadline: u64,
    ) -> u128 {
        sender.require_auth();
        ensure_initialized(&env);
        check_deadline(&env, deadline);

        if hops.is_empty() || hops.len() > 3 {
            panic_with_error!(&env, RouterError::InvalidPath);
        }

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let factory_client = PoolFactoryClient::new(&env, &factory);

        // For exact-output we simulate the path in reverse to compute required
        // input at each hop, then execute forward.
        let n = hops.len();

        // Build token sequence: [token_in_0, token_in_1, ..., token_out]
        let mut tokens: Vec<Address> = Vec::new(&env);
        for i in 0..n {
            tokens.push_back(hops.get(i).unwrap().token_in.clone());
        }
        tokens.push_back(token_out.clone());

        // Simulate reverse to find required amounts at each hop.
        // amounts[i] = amount that must enter hop i.
        let mut amounts: Vec<u128> = Vec::new(&env);
        // Pre-fill with zeros; we'll set them via reverse pass.
        for _ in 0..=n {
            amounts.push_back(0u128);
        }
        amounts.set(n as u32, amount_out);

        for i in (0..n).rev() {
            let hop = hops.get(i as u32).unwrap();
            let next_token = tokens.get(i as u32 + 1).unwrap();

            let pool_addr = factory_client
                .get_pool(&hop.token_in, &next_token, &hop.fee_tier)
                .unwrap_or_else(|| panic_with_error!(&env, RouterError::PoolNotFound));

            let pool = ClPoolClient::new(&env, &pool_addr);
            let sqrt_price = pool.get_sqrt_price();

            // Approximate required input from pool's current sqrt price.
            // amount_in ≈ amount_out * sqrt_price^2 / Q96^2  (for zero_for_one=false)
            // or amount_in ≈ amount_out * Q96^2 / sqrt_price^2 (for zero_for_one=true)
            let zero_for_one = is_token0(&hop.token_in, &next_token);
            let q96: u128 = 1u128 << 96;
            let required_in = if zero_for_one {
                // token0 in, token1 out: price = token1/token0 = (sqrt/Q96)^2
                // amount_in = amount_out * Q96^2 / sqrt^2
                let out = amounts.get(i as u32 + 1).unwrap();
                if sqrt_price == 0 {
                    out
                } else {
                    out.saturating_mul(q96) / sqrt_price
                }
            } else {
                // token1 in, token0 out
                let out = amounts.get(i as u32 + 1).unwrap();
                out.saturating_mul(sqrt_price) / q96
            };
            amounts.set(i as u32, required_in);
        }

        let total_in = amounts.get(0).unwrap();
        if total_in > amount_in_max {
            panic_with_error!(&env, RouterError::TooMuchRequested);
        }

        // Execute forward with the computed input amounts.
        let mut current_amount = total_in;
        for i in 0..n {
            let hop = hops.get(i as u32).unwrap();
            let next_token = tokens.get(i as u32 + 1).unwrap();

            let pool_addr = factory_client
                .get_pool(&hop.token_in, &next_token, &hop.fee_tier)
                .unwrap_or_else(|| panic_with_error!(&env, RouterError::PoolNotFound));

            let pool = ClPoolClient::new(&env, &pool_addr);
            let zero_for_one = is_token0(&hop.token_in, &next_token);
            let sqrt_limit = if zero_for_one { 1u128 } else { u128::MAX };

            let swap_sender = if i == 0 {
                sender.clone()
            } else {
                env.current_contract_address()
            };

            let (delta0, delta1) =
                pool.swap(&swap_sender, &zero_for_one, &current_amount, &sqrt_limit);

            let out = if zero_for_one {
                (-delta1) as u128
            } else {
                (-delta0) as u128
            };

            env.events().publish(
                (Symbol::new(&env, "Swap"),),
                (
                    hop.token_in.clone(),
                    next_token.clone(),
                    hop.fee_tier,
                    current_amount,
                    out,
                ),
            );

            current_amount = out;
        }

        // Transfer final output to recipient if it ended up in the router.
        if n > 1 {
            token::Client::new(&env, &token_out).transfer(
                &env.current_contract_address(),
                &recipient,
                &(current_amount as i128),
            );
        }

        total_in
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
        panic_with_error!(env, RouterError::NotInitialized);
    }
}

fn check_deadline(env: &Env, deadline: u64) {
    if env.ledger().timestamp() > deadline {
        panic_with_error!(env, RouterError::DeadlineExpired);
    }
}

/// Returns true if `a` sorts before `b` (i.e. `a` is token0 in the pool).
/// Mirrors the `normalize_pair` logic in pool-factory.
fn is_token0(a: &Address, b: &Address) -> bool {
    use soroban_sdk::IntoVal;
    // Both addresses share the same Env; borrow it from `a`.
    let env = a.env();
    let val_a: soroban_sdk::Val = a.clone().into_val(env);
    let val_b: soroban_sdk::Val = b.clone().into_val(env);
    val_a < val_b
}
