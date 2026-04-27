#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{
    ExactInputSingleParams, ExactOutputSingleParams, Router, RouterClient, RouterError,
};

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(Router, ());
    (env, id)
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

    // deadline in the past (ledger timestamp starts at 0, deadline = 0 is already expired
    // when ledger advances, but here we set it to 0 and rely on timestamp > 0 after a bump)
    env.ledger().with_mut(|l| l.timestamp = 100);

    client.exact_input_single(&ExactInputSingleParams {
        token_in,
        token_out,
        fee: 3000,
        recipient,
        deadline: 50, // expired
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
        amount_in: 0, // zero — should panic
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
        deadline: 100, // expired
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
        amount_out: 0, // zero — should panic
        amount_in_max: 1_000,
        sqrt_price_limit_x96: 0,
    });
}
