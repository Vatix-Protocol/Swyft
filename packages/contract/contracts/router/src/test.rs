#![cfg(test)]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, testutils::Address as _,
    testutils::Events, testutils::Ledger, Address, Env, Symbol, TryIntoVal,
};

use crate::{ExactInputSingleParams, ExactOutputSingleParams, Router, RouterClient, SwapResult};

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

/// Test-only pool: amount_out = amount_in - amount_in/1000 (0.1% fee).
#[contract]
pub struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn swap(
        _env: Env,
        _token_in: Address,
        _token_out: Address,
        amount: u128,
        exact_input: bool,
        _sqrt_price_limit_x96: u128,
    ) -> SwapResult {
        let fee = amount / 1000;
        if exact_input {
            SwapResult {
                amount_in: amount,
                amount_out: amount - fee,
            }
        } else {
            let amount_in = amount + fee;
            SwapResult {
                amount_in,
                amount_out: amount,
            }
        }
    }
}

fn setup_router_with_mock_pool(env: &Env) -> RouterClient<'_> {
    let router_id = env.register(Router, ());
    let factory_id = env.register(MockFactory, ());
    let pool_id = env.register(MockPool, ());

    MockFactoryClient::new(env, &factory_id).set_pool(&pool_id);
    let client = RouterClient::new(env, &router_id);
    client.initialize(&factory_id);
    client
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
    let client = setup_router_with_mock_pool(&env);

    let result = client.try_exact_input_single(&ExactInputSingleParams {
        token_in: Address::generate(&env),
        token_out: Address::generate(&env),
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
    let client = setup_router_with_mock_pool(&env);

    // amount_in=1000 → amount_out=999
    let swap = client.exact_input_single(&ExactInputSingleParams {
        token_in: Address::generate(&env),
        token_out: Address::generate(&env),
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
    let client = setup_router_with_mock_pool(&env);

    let before_len = env.events().all().len();

    let result = client.try_exact_input_single(&ExactInputSingleParams {
        token_in: Address::generate(&env),
        token_out: Address::generate(&env),
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
