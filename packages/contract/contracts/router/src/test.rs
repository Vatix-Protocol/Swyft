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
    client.initialize(&Address::generate(env), &factory_id);
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
    let factory_id = env.register(MockFactory, ());
    client.initialize(&Address::generate(&env), &factory_id);
    assert_eq!(client.get_factory(), factory_id);
}

#[test]
fn test_get_factory_and_get_admin_panic_before_initialize() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);

    assert!(client.try_get_factory().is_err());
    assert!(client.try_get_admin().is_err());
}

#[test]
fn test_initialize_rejects_non_contract_factory() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory = Address::generate(&env);

    assert!(client.try_initialize(&Address::generate(&env), &factory).is_err());
}

#[test]
fn test_factory_configuration_requires_admin_and_cannot_be_replaced() {
    let env = Env::default();
    let router_id = env.register(Router, ());
    let client = RouterClient::new(&env, &router_id);
    let admin = Address::generate(&env);
    let factory_id = env.register(MockFactory, ());
    let attacker_factory = env.register(MockFactory, ());

    assert!(client.try_initialize(&admin, &factory_id).is_err());
    assert!(client.try_get_factory().is_err());

    env.mock_all_auths();
    client.initialize(&admin, &factory_id);
    assert_eq!(client.get_admin(), admin);
    assert!(client.try_initialize(&admin, &attacker_factory).is_err());
    assert_eq!(client.get_factory(), factory_id);
}

#[test]
#[should_panic]
fn test_exact_input_single_deadline_expired() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory_id = env.register(MockFactory, ());
    client.initialize(&Address::generate(&env), &factory_id);

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
    let factory_id = env.register(MockFactory, ());
    client.initialize(&Address::generate(&env), &factory_id);

    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.exact_input_single(&ExactInputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: env.ledger().timestamp() + 120,
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
    let factory_id = env.register(MockFactory, ());
    client.initialize(&Address::generate(&env), &factory_id);

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
fn test_exact_input_single_deadline_too_far() {
    let env = Env::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 100);

    crate::check_deadline(&env, 100 + crate::MAX_SWAP_DEADLINE_SECONDS + 1);
}

#[test]
fn test_deadline_at_maximum_ttl_is_valid() {
    let env = Env::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 100);

    crate::check_deadline(&env, 100 + crate::MAX_SWAP_DEADLINE_SECONDS);
}

#[test]
#[should_panic]
fn test_exact_output_single_zero_amount() {
    let (env, id) = setup();
    let client = RouterClient::new(&env, &id);
    let factory_id = env.register(MockFactory, ());
    client.initialize(&Address::generate(&env), &factory_id);

    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.exact_output_single(&ExactOutputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: env.ledger().timestamp() + 120,
        amount_out: 0,
        amount_in_max: 1_000,
        sqrt_price_limit_x96: 0,
    });
}

/// Pins the exact-output surface: `exact_output_single` is declared unsupported
/// and must revert with `RouterError::ExactOutputUnsupported` (code 9) rather
/// than silently degrading to an exact-input swap. This keeps the SDK's
/// exact-output path unambiguous.
#[test]
fn test_exact_output_single_reverts_unsupported() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    let recipient = Address::generate(&env);
    let result = s.client.try_exact_output_single(&ExactOutputSingleParams {
        token_in: s.token_in.clone(),
        token_out: s.token_out.clone(),
        fee: 3000,
        recipient,
        deadline: env.ledger().timestamp() + 120,
        amount_out: 500,
        amount_in_max: 1_000,
        sqrt_price_limit_x96: 0,
    });

    assert!(result.is_err());
}

/// amount_in=1000 → amount_out=999. minOut=1000 must revert (under slippage).
#[test]
fn test_exact_input_reverts_when_amount_out_below_min_out() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setu

    let result = s.client.try_exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: s.token_out,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: env.ledger().timestamp() + 120,
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
fn test_exact_input_succeeds_at_min_out_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    let result = s.client.try_exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: s.token_out,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: env.ledger().timestamp() + 120,
        amount_in: 1_000,
        amount_out_min: 999,
        sqrt_price_limit_x96: 0,
    });

    assert!(
        result.is_ok(),
        "expected success when amount_out == amount_out_min"
    );
}

/// The router must derive `zero_for_one` from the pool's token ordering, not
/// from the caller's argument order. Passing `(token_0, token_1)` and
/// `(token_1, token_0)` against the same pool must yield mirrored deltas.
#[test]
fn test_exact_input_single_resolves_direction_from_pool_token_order() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    let amount_in = 1_000u128;
    let out = amount_in - amount_in / 1000;

    // token_in == pool token_0, token_out == pool token_1 → zero_for_one = true
    let forward = s.client.exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: s.token_out,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: env.ledger().timestamp() + 120,
        amount_in,
        amount_out_min: 0,
        sqrt_price_limit_x96: 0,
    });
    assert_eq!(forward, (amount_in as i128, -(out as i128)));

    // token_in == pool token_1, token_out == pool token_0 → zero_for_one = false
    let reverse = s.client.exact_input_single(&ExactInputSingleParams {
        token_in: s.token_out,
        token_out: s.token_in,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: env.ledger().timestamp() + 120,
        amount_in,
        amount_out_min: 0,
        sqrt_price_limit_x96: 0,
    });
    assert_eq!(reverse, (-(out as i128), amount_in as i128));
}

/// A token pair that matches neither ordering of the pool's tokens must be
/// rejected with a typed router error instead of calling `swap`.
#[test]
fn test_exact_input_single_rejects_mismatched_token_pair() {
    let env = Env::default();
    env.mock_all_auths();
    let s = setup_router_with_mock_pool(&env);

    let stranger = Address::generate(&env);

    let result = s.client.try_exact_input_single(&ExactInputSingleParams {
        token_in: s.token_in,
        token_out: stranger,
        fee: 3000,
        recipient: Address::generate(&env),
        deadline: env.ledger().timestamp() + 120,
        amount_in: 1_000,
        amount_out_min: 0,
        sqrt_price_limit_x96: 0,
    });

    assert!(
        result.is_err(),
        "expected a typed router error for a token pair not matching the pool"
    );
}
