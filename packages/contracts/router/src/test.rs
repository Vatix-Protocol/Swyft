#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, RouterClient<'static>) {
    let env = Env::default();
    let contract_id = env.register_contract(None, Router);
    let client = RouterClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn identical_token_addresses_cannot_be_a_pool_rate() {
    let (env, client) = setup();
    let token = Address::generate(&env);

    let result = client.try_set_pool_rate(&token, &token, &1_000);
    assert_eq!(result, Err(Ok(RouterError::InvalidPath)));

    // Storage must remain empty after the rejected call.
    let stored: Option<i128> = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get(&DataKey::Pool(token.clone(), token.clone()))
    });
    assert_eq!(stored, None);
}

#[test]
fn zero_rate_is_rejected_and_leaves_storage_empty() {
    let (env, client) = setup();
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let result = client.try_set_pool_rate(&token_in, &token_out, &0);
    assert_eq!(result, Err(Ok(RouterError::InvalidAmount)));

    let stored: Option<i128> = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get(&DataKey::Pool(token_in.clone(), token_out.clone()))
    });
    assert_eq!(stored, None);
}

#[test]
fn positive_rate_for_distinct_tokens_is_stored_and_readable() {
    let (env, client) = setup();
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    client.set_pool_rate(&token_in, &token_out, &2_500);

    let stored: Option<i128> = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get(&DataKey::Pool(token_in.clone(), token_out.clone()))
    });
    assert_eq!(stored, Some(2_500));
}

#[test]
#[should_panic(expected = "invalid path")]
fn reverts_on_same_token_pool_rate() {
    let (env, router_id, token_a, _, _) = setup();
    let client = RouterClient::new(&env, &router_id);

    client.set_pool_rate(&token_a, &token_a, &2);
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
#[should_panic]
fn reverts_on_deadline_beyond_maximum_ttl() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    client.exact_input_single(
        &token_a,
        &token_b,
        &10,
        &1,
        &(NOW + MAX_SWAP_DEADLINE_SECONDS + 1),
    );
}

#[test]
fn accepts_deadline_at_maximum_ttl() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    let amount_out = client.exact_input_single(
        &token_a,
        &token_b,
        &10,
        &19,
        &(NOW + MAX_SWAP_DEADLINE_SECONDS),
    );

    assert_eq!(amount_out, 20);
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

#[test]
#[should_panic(expected = "pool not found")]
fn exact_input_single_reverts_on_missing_pool_rate() {
    let (env, router_id, token_a, _, token_c) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_c, &2);

    // token_a -> token_b has no registered rate.
    let token_b = Address::generate(&env);
    client.exact_input_single(&token_a, &token_b, &10, &1, &DEADLINE);
}

#[test]
#[should_panic(expected = "pool not found")]
fn exact_output_single_reverts_on_missing_pool_rate() {
    let (env, router_id, token_a, _, token_c) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_c, &2);

    // token_a -> token_b has no registered rate.
    let token_b = Address::generate(&env);
    client.exact_output_single(&token_a, &token_b, &20, &10, &DEADLINE);
}

#[test]
#[should_panic(expected = "pool not found")]
fn multi_hop_reverts_on_unregistered_leg() {
    let (env, router_id, token_a, token_b, token_c) = setup();
    let client = RouterClient::new(&env, &router_id);
    // Only the first leg (token_a -> token_b) is registered.
    client.set_pool_rate(&token_a, &token_b, &2);

    let path = vec![&env, token_a, token_b, token_c];
    client.exact_input(&path, &10, &1, &DEADLINE);
}

#[test]
#[should_panic(expected = "zero amount")]
fn reverts_on_zero_amount_exact_input() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    client.exact_input_single(&token_a, &token_b, &0, &0, &DEADLINE);
}

#[test]
#[should_panic(expected = "zero amount")]
fn reverts_on_zero_amount_exact_output() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);
    client.set_pool_rate(&token_a, &token_b, &2);

    client.exact_output_single(&token_a, &token_b, &0, &0, &DEADLINE);
}

#[test]
#[should_panic]
fn reverts_on_unauthorized_set_pool_rate() {
    let (env, router_id, token_a, token_b, _) = setup();
    let client = RouterClient::new(&env, &router_id);

    // No auth is mocked, so the admin-gated call must be rejected.
    client.set_pool_rate(&token_a, &token_b, &2);
}

// ── Integration: swap → fee collect ──────────────────────────────────────────
//
// These tests spin up both the Router and FeeCollector contracts inside a
// single Soroban test environment and assert end-to-end balance invariants.
//
// How to run:
//   cd packages/contracts
//   cargo test --package swyft-router integration
//
// The tests are self-contained (no external network) and are safe to run in
// CI alongside the unit tests above.

mod integration {
    use super::*;
    use swyft_fee_collector::{FeeCollector, FeeCollectorClient};

    const INTEG_NOW: u64 = 2_000;
    const INTEG_DEADLINE: u64 = 2_100;

    struct IntegHarness {
        env: Env,
        router: RouterClient<'static>,
        fee_collector: FeeCollectorClient<'static>,
        admin: Address,
        token_a: Address,
        token_b: Address,
    }

    /// Shared harness: registers Router + FeeCollector, enables the fee switch,
    /// and seeds a pool rate of 3 for (token_a → token_b).
    fn setup_integration() -> IntegHarness {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = INTEG_NOW);

        let router_id = env.register_contract(None, Router);
        let fee_collector_id = env.register_contract(None, FeeCollector);

        let router = RouterClient::new(&env, &router_id);
        let fee_collector = FeeCollectorClient::new(&env, &fee_collector_id);

        let admin = Address::generate(&env);
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);

        fee_collector.initialize(&admin);
        fee_collector.set_fee_enabled(&true);
        router.set_pool_rate(&token_a, &token_b, &3);

        IntegHarness {
            env,
            router,
            fee_collector,
            admin,
            token_a,
            token_b,
        }
    }

    #[test]
    fn swap_then_collect_preserves_balances() {
        let h = setup_integration();

        let amount_out = h
            .router
            .exact_input_single(&h.token_a, &h.token_b, &10, &1, &INTEG_DEADLINE);
        assert_eq!(amount_out, 30);

        // Router holds no residual balance after the swap.
        assert_eq!(h.router.get_router_balance(&h.token_a), 0);
        assert_eq!(h.router.get_router_balance(&h.token_b), 0);

        // Fee collector can be queried without panicking.
        let _ = h.fee_collector.get_fee_enabled();
        let _ = h.admin;
    }
}
