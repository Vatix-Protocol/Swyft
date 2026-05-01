#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{Pool, PoolClient, Q96};

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Pool, ());
    let token_0 = Address::generate(&env);
    let token_1 = Address::generate(&env);
    let lp = Address::generate(&env);
    (env, contract_id, token_0, token_1, lp)
}

// ── Tick bitmap ───────────────────────────────────────────────────────────────

#[test]
fn test_flip_tick_marks_and_unmarks() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // flip on
    client.flip_tick(&60, &60);
    let (next, found) = client.next_initialized_tick(&0, &60, &false);
    assert!(found);
    assert_eq!(next, 60);

    // flip off
    client.flip_tick(&60, &60);
    let (_next, found2) = client.next_initialized_tick(&0, &60, &false);
    assert!(!found2);
}

#[test]
fn test_next_initialized_tick_lte() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.flip_tick(&-120, &60);
    let (next, found) = client.next_initialized_tick(&0, &60, &true);
    assert!(found);
    assert_eq!(next, -120);
}

// ── Mint / Burn ───────────────────────────────────────────────────────────────

#[test]
fn test_mint_adds_liquidity_in_range() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    // sqrt price at tick 0 = Q96
    client.initialize(&t0, &t1, &Q96, &3000u32);

    let result = client.mint(&1u64, &-60, &60, &1_000_000u128);
    assert!(result.amount_0 > 0 || result.amount_1 > 0);

    let state = client.get_state();
    assert_eq!(state.liquidity, 1_000_000u128);
}

#[test]
fn test_mint_out_of_range_does_not_add_active_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.mint(&2u64, &120, &240, &500_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 0);
}

#[test]
fn test_burn_removes_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.mint(&3u64, &-60, &60, &1_000_000u128);
    let burn_result = client.burn(&3u64, &-60, &60, &1_000_000u128);
    assert!(burn_result.amount_0 > 0 || burn_result.amount_1 > 0);

    let state = client.get_state();
    assert_eq!(state.liquidity, 0);
}

#[test]
fn test_partial_burn() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.mint(&4u64, &-60, &60, &1_000_000u128);
    client.burn(&4u64, &-60, &60, &400_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 600_000u128);
}

// ── Fee accumulation ──────────────────────────────────────────────────────────

#[test]
fn test_fees_accumulate_with_active_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);
    client.mint(&lp, &-60, &60, &1_000_000u128);

    client.accrue_fees(&1_000u128, &2_000u128);
    let state = client.get_state();
    assert!(state.fee_growth_global_0_x128 > 0);
    assert!(state.fee_growth_global_1_x128 > 0);
}

#[test]
fn test_fees_do_not_accumulate_without_liquidity() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.accrue_fees(&1_000u128, &2_000u128);
    let state = client.get_state();
    assert_eq!(state.fee_growth_global_0_x128, 0);
    assert_eq!(state.fee_growth_global_1_x128, 0);
}

// ── Tick crossing ─────────────────────────────────────────────────────────────

#[test]
fn test_cross_tick_updates_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Add liquidity starting at tick 60 (above current)
    client.mint(&lp, &60, &120, &500_000u128);
    let before = client.get_state().liquidity;

    // Simulate price moving into the range by crossing tick 60
    client.cross_tick(&60, &false);
    let after = client.get_state().liquidity;
    assert!(after > before);
}

// ── Pool state ────────────────────────────────────────────────────────────────

#[test]
fn test_pool_state_exposes_required_fields() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    let state = client.get_state();
    assert_eq!(state.sqrt_price_x96, Q96);
    assert_eq!(state.tick, 0);
    assert_eq!(state.liquidity, 0);
    assert_eq!(state.fee_growth_global_0_x128, 0);
    assert_eq!(state.fee_growth_global_1_x128, 0);
}

#[test]
fn test_set_price_updates_tick() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Move price up
    let new_price = Q96 * 2;
    client.set_price(&new_price);
    let state = client.get_state();
    assert_eq!(state.sqrt_price_x96, new_price);
    assert!(state.tick > 0);
}

// ── NFT position lifecycle (simulated) ───────────────────────────────────────

#[test]
fn test_full_lp_lifecycle() {
    let (env, id, t0, t1, lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // 1. Add liquidity
    let mint_res = client.mint(&lp, &-60, &60, &1_000_000u128);
    assert!(mint_res.amount_0 > 0 || mint_res.amount_1 > 0);
    assert_eq!(client.get_state().liquidity, 1_000_000u128);

    // 2. Simulate swap fees
    client.accrue_fees(&3_000u128, &6_000u128);
    let state_after_fees = client.get_state();
    assert!(state_after_fees.fee_growth_global_0_x128 > 0);

    // 3. Remove full liquidity
    let burn_res = client.burn(&lp, &-60, &60, &1_000_000u128);
    assert!(burn_res.amount_0 > 0 || burn_res.amount_1 > 0);
    assert_eq!(client.get_state().liquidity, 0);
}
