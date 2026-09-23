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
        fee_collector.set_fee_switch(&true);
        router.set_pool_rate(&token_a, &token_b, &3);

        IntegHarness { env, router, fee_collector, admin, token_a, token_b }
    }

    /// A successful swap produces the expected output (rate=3, amount_in=10 → 30)
    /// and leaves the router balance at zero (the router is stateless).
    #[test]
    fn swap_produces_correct_output_and_zero_router_balance() {
        let h = setup_integration();

        let amount_out = h.router.exact_input_single(
            &h.token_a, &h.token_b, &10, &1, &INTEG_DEADLINE,
        );

        assert_eq!(amount_out, 30);
        assert_eq!(h.router.get_router_balance(&h.token_a), 0);
        assert_eq!(h.router.get_router_balance(&h.token_b), 0);
    }

    /// A single-hop swap emits exactly one SwapEvent.
    #[test]
    fn swap_emits_one_event() {
        let h = setup_integration();
        h.router.exact_input_single(&h.token_a, &h.token_b, &5, &1, &INTEG_DEADLINE);
        assert_eq!(h.env.events().all().len(), 1);
    }

    /// Full swap → deposit fees → collect fees path:
    ///   1. Swap succeeds and returns expected output.
    ///   2. deposit_protocol_fees records the fee balance.
    ///   3. collect_protocol_fees drains it and returns the exact amount.
    ///   4. get_accumulated_fees is zero after collection.
    #[test]
    fn swap_then_fee_collect_full_path() {
        let h = setup_integration();

        // Step 1 — swap
        let amount_out = h.router.exact_input_single(
            &h.token_a, &h.token_b, &10, &1, &INTEG_DEADLINE,
        );
        assert_eq!(amount_out, 30, "rate=3 × amount_in=10 should yield 30");

        // Step 2 — a pool/hook deposits protocol fees earned on token_b
        let depositor = Address::generate(&h.env);
        let fee_amount: i128 = 6;
        let accumulated =
            h.fee_collector.deposit_protocol_fees(&h.token_b, &depositor, &fee_amount);
        assert_eq!(accumulated, fee_amount, "balance after deposit should equal deposited amount");

        // Step 3 — admin collects the fees
        let collected = h.fee_collector.collect_protocol_fees(&h.token_b, &h.admin);
        assert_eq!(collected, fee_amount, "collected amount should match deposited fee");

        // Step 4 — balance is zeroed
        assert_eq!(
            h.fee_collector.get_accumulated_fees(&h.token_b),
            0,
            "accumulated fees should be zero after collection"
        );
    }

    /// deposit_protocol_fees is a no-op when the fee switch is disabled:
    /// the balance is unchanged and no funds are transferred.
    #[test]
    fn deposit_is_noop_when_fee_switch_off() {
        let h = setup_integration();
        h.fee_collector.set_fee_switch(&false);

        let balance_before = h.fee_collector.get_accumulated_fees(&h.token_b);
        let depositor = Address::generate(&h.env);
        let returned =
            h.fee_collector.deposit_protocol_fees(&h.token_b, &depositor, &100);

        assert_eq!(returned, balance_before, "deposit should be no-op when fee switch is off");
        assert_eq!(h.fee_collector.get_accumulated_fees(&h.token_b), balance_before);
    }

    /// Multi-hop swap A→B→C, then collect fees on the intermediate token B.
    #[test]
    fn multi_hop_swap_then_fee_collect() {
        let h = setup_integration();
        let token_c = Address::generate(&h.env);
        h.router.set_pool_rate(&h.token_b, &token_c, &2);

        // A→B (rate 3) → B→C (rate 2): 10 × 3 × 2 = 60
        let path = soroban_sdk::vec![
            &h.env,
            h.token_a.clone(),
            h.token_b.clone(),
            token_c.clone()
        ];
        let amount_out = h.router.exact_input(&path, &10, &1, &INTEG_DEADLINE);
        assert_eq!(amount_out, 60);

        // Two hops → two swap events
        assert_eq!(h.env.events().all().len(), 2);

        // Deposit and collect intermediate-token fees
        let depositor = Address::generate(&h.env);
        h.fee_collector.deposit_protocol_fees(&h.token_b, &depositor, &4);
        let collected = h.fee_collector.collect_protocol_fees(&h.token_b, &h.admin);
        assert_eq!(collected, 4);
        assert_eq!(h.fee_collector.get_accumulated_fees(&h.token_b), 0);
    }

    /// Collecting fees with zero balance must panic with "no protocol fees to collect".
    #[test]
    #[should_panic(expected = "no protocol fees to collect")]
    fn collect_with_zero_balance_panics() {
        let h = setup_integration();
        // No deposit was made — balance is 0
        h.fee_collector.collect_protocol_fees(&h.token_b, &h.admin);
    }
}
