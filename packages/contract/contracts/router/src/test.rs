#![cfg(test)]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, testutils::Address as _,
    testutils::Events, testutils::Ledger, token, Address, Env, Symbol, TryIntoVal,
};

use cl_pool::{ClPool, ClPoolClient, Q96};
use position_nft::{PositionNft, PositionNftClient};

use crate::{ExactInputSingleParams, ExactOutputSingleParams, Router, RouterClient};

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(Router, ());
    (env, id)
}

/// Test-only factory that always returns a fixed pool address.
#[contract]
pub struct MockFactory;

#[contracttype]
#[derive(Clone)]
enum MockFactoryKey {
    Pool,
}

#[contractimpl]
impl MockFactory {
    pub fn set_pool(env: Env, pool: Address) {
        env.storage()
            .instance()
            .set(&MockFactoryKey::Pool, &pool);
    }

    pub fn get_pool(
        env: Env,
        _token_a: Address,
        _token_b: Address,
        _fee: u32,
    ) -> Option<Address> {
        env.storage().instance().get(&MockFactoryKey::Pool)
    }
}

/// Test-only pool mirroring the `cl-pool` swap interface the router targets:
/// `swap(sender, zero_for_one, amount_in, sqrt_price_limit_x96) -> (i128, i128)`.
/// amount_out = amount_in - amount_in/1000 (0.1% fee); returns signed deltas.
#[contract]
pub struct MockPool;

#[contracttype]
#[derive(Clone)]
enum MockPoolKey {
    Token0,
    Token1,
}

#[contractimpl]
impl MockPool {
    pub fn set_tokens(env: Env, token_0: Address, token_1: Address) {
        env.storage().instance().set(&MockPoolKey::Token0, &token_0);
        env.storage().instance().set(&MockPoolKey::Token1, &token_1);
    }

    pub fn get_token_0(env: Env) -> Address {
        env.storage().instance().get(&MockPoolKey::Token0).unwrap()
    }

    pub fn get_token_1(env: Env) -> Address {
        env.storage().instance().get(&MockPoolKey::Token1).unwrap()
    }

    pub fn swap(
        _env: Env,
        _sender: Address,
        zero_for_one: bool,
        amount: u128,
        _sqrt_price_limit_x96: u128,
    ) -> (i128, i128) {
        let fee = amount / 1000;
        let out = amount - fee;
        if zero_for_one {
            (amount as i128, -(out as i128))
        } else {
            (-(out as i128), amount as i128)
        }
    }
}

struct MockSwapSetup<'a> {
    client: RouterClient<'a>,
    token_in: Address,
    token_out: Address,
}

fn setup_router_with_mock_pool(env: &Env) -> MockSwapSetup<'_> {
    let router_id = env.register(Router, ());
    let factory_id = env.register(MockFactory, ());
    let pool_id = env.register(MockPool, ());

    let token_in = Address::generate(env);
    let token_out = Address::generate(env);
    MockPoolClient::new(env, &pool_id).set_tokens(&token_in, &token_out);

    MockFactoryClient::new(env, &factory_id).set_pool(&pool_id);
    let client = RouterClient::new(env, &router_id);
    client.initialize(&factory_id);
    MockSwapSetup {
        client,
        token_in,
        token_out,
    }
}

#[test]
fn test_initialize_and_get_factory() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory = Address::generate(&env);
    client.initialize(&factory);
    assert_eq!(client.get_factory(), factory);
}

#[test]
#[should_panic]
fn test_exact_input_single_deadline_expired() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory = Address::generate(&env);
    client.initialize(&factory);

    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.ledger().with_mut(|l| l.timestamp = 100);

    client.exact_input_single(&ExactInputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: 50,
        amount_in: 1_000,
        amount_out_min: 0,
        sqrt_price_limit_x96: 0,
    });
}

#[test]
#[should_panic]
fn test_exact_input_single_zero_amount() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory = Address::generate(&env);
    client.initialize(&factory);

    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.exact_input_single(&ExactInputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: u64::MAX,
        amount_in: 0,
        amount_out_min: 0,
        sqrt_price_limit_x96: 0,
    });
}

#[test]
#[should_panic]
fn test_exact_output_single_deadline_expired() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory = Address::generate(&env);
    client.initialize(&factory);

    env.ledger().with_mut(|l| l.timestamp = 200);

    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.exact_output_single(&ExactOutputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: 100,
        amount_out: 500,
        amount_in_max: 1_000,
        sqrt_price_limit_x96: 0,
    });
}

#[test]
#[should_panic]
fn test_exact_output_single_zero_amount() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory = Address::generate(&env);
    client.initialize(&factory);

    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.exact_output_single(&ExactOutputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: u64::MAX,
        amount_out: 0,
        amount_in_max: 1_000,
        sqrt_price_limit_x96: 0,
    });
}

/// amount_in=1000 → amount_out=999. minOut=1000 must revert (under slippage).
#[test]
fn test_exact_input_reverts_when_amount_out_below_min_out() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    let result = s.client.try_exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: s.token_out,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: u64::MAX,
        amount_in: 1_000,
        amount_out_min: 1_000,
        sqrt_price_limit_x96: 0,
    });

    assert!(
        result.is_err(),
        "expected SlippageExceeded when amount_out < amount_out_min"
    );
}

/// Exact boundary: amount_out == amount_out_min succeeds (inclusive).
#[test]
fn test_exact_input_succeeds_when_amount_out_equals_min_out() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    // amount_in=1000 → amount_out=999
    let swap = s.client.exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: s.token_out,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: u64::MAX,
        amount_in: 1_000,
        amount_out_min: 999,
        sqrt_price_limit_x96: 0,
    });

    assert_eq!(swap.amount_out, 999);
    assert_eq!(swap.amount_in, 1_000);
}

/// Under-minOut reverts must not publish a Swap event.
#[test]
fn test_exact_input_emits_no_swap_event_on_slippage_revert() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    let before_len = env.events().all().len();

    let result = s.client.try_exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: s.token_out,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: u64::MAX,
        amount_in: 1_000,
        amount_out_min: 1_000,
        sqrt_price_limit_x96: 0,
    });
    assert!(result.is_err());

    let after = env.events().all();
    assert_eq!(
        after.len(),
        before_len,
        "no events should be published when minOut check reverts"
    );

    let swap_sym = symbol_short!("Swap");
    for (_addr, topics, _data) in after.iter() {
        for topic in topics.iter() {
            let as_sym: Option<Symbol> = topic.try_into_val(&env).ok();
            assert_ne!(
                as_sym,
                Some(swap_sym.clone()),
                "Swap event must not be emitted on slippage revert"
            );
        }
    }
}

// ── Router ↔ real cl-pool integration ───────────────────────────────────────
//
// Before the `execute_swap` alignment, this test failed: the router invoked
// `pool.swap(token_in, token_out, amount, exact_input, limit)` and tried to
// deserialize the return value as `SwapResult`, but `cl-pool.swap` has a
// different signature and returns `(i128, i128)`. It now exercises the full
// router → factory → cl-pool handoff and asserts the mapped SwapResult matches
// the on-chain balances actually moved.

const LP_LIQUIDITY: u128 = 1_000_000_000_000; // arbitrary in-range liquidity
const SWAP_AMOUNT_IN: u128 = 1_000_000;

fn setup_real_cl_pool(env: &Env) -> (RouterClient<'_>, Address, Address, Address) {
    let admin = Address::generate(env);
    let token_0 = env.register_stellar_asset_contract(&admin);
    let token_1 = env.register_stellar_asset_contract(&admin);

    let nft = env.register(PositionNft, ());
    let pool = env.register(ClPool, ());
    PositionNftClient::new(env, &nft).initialize(&pool);
    ClPoolClient::new(env, &pool).initialize(&token_0, &token_1, &3000, &Q96, &nft);

    // Seed liquidity: fund an LP provider and add an in-range position.
    let lp = Address::generate(env);
    let lp_funding = 1_000_000_000_000_000u128;
    token::Client::new(env, &token_0).mint(&lp, &(lp_funding as i128));
    token::Client::new(env, &token_1).mint(&lp, &(lp_funding as i128));
    ClPoolClient::new(env, &pool).add_liquidity(&lp, &-1000, &1000, &LP_LIQUIDITY);

    // Wire a router to the pool through the test factory.
    let factory = env.register(MockFactory, ());
    MockFactoryClient::new(env, &factory).set_pool(&pool);
    let router = env.register(Router, ());
    let client = RouterClient::new(env, &router);
    client.initialize(&factory);

    (client, token_0, token_1, lp)
}

/// The align fix must produce a real, non-fake swap against a live cl-pool:
/// token0 → token1 (zero_for_one), recipient funds and receives via the pool.
#[test]
fn test_exact_input_single_round_trips_through_real_cl_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_0, token_1, _lp) = setup_real_cl_pool(&env);

    let user = Address::generate(&env);
    token::Client::new(&env, &token_0).mint(&user, &(SWAP_AMOUNT_IN as i128));

    let result = client.exact_input_single(&ExactInputSingleParams {
        token_in: token_0.clone(),
        token_out: token_1.clone(),
        fee: 3000,
        recipient: user.clone(),
        deadline: u64::MAX,
        amount_in: SWAP_AMOUNT_IN,
        // cl-pool has in-range liquidity, so output must be > 0; minOut=1 guards
        // against a silent zero-output "success".
        amount_out_min: 1,
        sqrt_price_limit_x96: 0,
    });

    // Cl-pool is an exact-input pool: the full amount_in is consumed.
    assert_eq!(result.amount_in, SWAP_AMOUNT_IN);
    // A real swap produced positive output (not a mocked/fake success).
    assert!(
        result.amount_out > 0 && result.amount_out < SWAP_AMOUNT_IN,
        "expected a positive, fee-reduced output, got {}",
        result.amount_out
    );

    // The user consumed amount_in of token0 …
    assert_eq!(
        token::Client::new(&env, &token_0).balance(&user),
        0i128,
        "user should have spent all of their token0"
    );
    // … and received exactly the reported output in token1 (real transfers,
    // proving the returned SwapResult matches Live balances).
    assert_eq!(
        token::Client::new(&env, &token_1).balance(&user),
        result.amount_out as i128,
        "reported amount_out must match the token1 actually received"
    );
}

/// Exact-output swaps cannot be honored by cl-pool (it is exact-input only);
/// the router must fail loudly instead of silently executing an unrelated swap.
#[test]
#[should_panic]
fn test_exact_output_single_reverts_as_unsupported() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_0, token_1, _lp) = setup_real_cl_pool(&env);

    client.exact_output_single(&ExactOutputSingleParams {
        token_in: token_0,
        token_out: token_1,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: u64::MAX,
        amount_out: 50_000,
        amount_in_max: 1_000_000,
        sqrt_price_limit_x96: 0,
    });
}
