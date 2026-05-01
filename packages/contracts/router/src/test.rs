use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env,
};

const NOW: u64 = 1_000;
const DEADLINE: u64 = 1_100;

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = NOW;
    });

    let router_id = env.register_contract(None, Router);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);
    let token_c = Address::generate(&env);

    (env, router_id, token_a, token_b, token_c)
}

#[test]
fn exact_input_single_success() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    let amount_out = client.exact_input_single(&token_a, &token_b, &10, &19, &DEADLINE);

    assert_eq!(amount_out, 20);
}

#[test]
fn exact_output_single_success() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    let amount_in = client.exact_output_single(&token_a, &token_b, &20, &10, &DEADLINE);

    assert_eq!(amount_in, 10);
}

#[test]
#[should_panic(expected = "slippage breach")]
fn reverts_on_slippage_breach() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    client.exact_input_single(&token_a, &token_b, &10, &21, &DEADLINE);
}

#[test]
#[should_panic(expected = "excessive input")]
fn reverts_on_excessive_input() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    client.exact_output_single(&token_a, &token_b, &20, &9, &DEADLINE);
}

#[test]
#[should_panic(expected = "expired deadline")]
fn reverts_on_expired_deadline() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    client.exact_input_single(&token_a, &token_b, &10, &1, &(NOW - 1));
}

#[test]
fn multi_hop_exact_input_success() {
    let (env, router_id, token_a, token_b, token_c) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);
    client.set_pool_rate(&token_b, &token_c, &3);

    let path = vec![&env, token_a, token_b, token_c];
    let amount_out = client.exact_input(&path, &10, &59, &DEADLINE);

    assert_eq!(amount_out, 60);
}

#[test]
fn multi_hop_exact_output_success() {
    let (env, router_id, token_a, token_b, token_c) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);
    client.set_pool_rate(&token_b, &token_c, &3);

    let path = vec![&env, token_a, token_b, token_c];
    let amount_in = client.exact_output(&path, &60, &10, &DEADLINE);

    assert_eq!(amount_in, 10);
}

#[test]
fn router_balance_is_zero_after_swap() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);
    client.exact_input_single(&token_a, &token_b, &10, &1, &DEADLINE);

    assert_eq!(client.get_router_balance(&token_a), 0);
    assert_eq!(client.get_router_balance(&token_b), 0);
}

#[test]
fn emits_event_per_hop() {
    let (env, router_id, token_a, token_b, token_c) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);
    client.set_pool_rate(&token_b, &token_c, &3);

    let path = vec![&env, token_a, token_b, token_c];
    client.exact_input(&path, &10, &1, &DEADLINE);

    assert_eq!(env.events().all().len(), 2);
}

#[test]
#[should_panic(expected = "hop failed")]
fn reverts_if_hop_fails() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);

    client.exact_input_single(&token_a, &token_b, &10, &1, &DEADLINE);
}
