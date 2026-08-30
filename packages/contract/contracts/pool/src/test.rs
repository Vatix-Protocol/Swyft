#![cfg(test)]
use soroban_sdk::{
    testutils::Address as _, testutils::Ledger, Address, Env,
};

use crate::{Pool, PoolClient, Q96};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Pool, ());
    let token_0 = Address::generate(&env);
    let token_1 = Address::generate(&env);
    (env, contract_id, token_0, token_1)
}

fn setup_with_oracle() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let pool_id = env.register(Pool, ());
    let oracle_id = env.register(OracleAdapter, ());
    let token_0 = Address::generate(&env);
    let token_1 = Address::generate(&env);

    let client = PoolClient::new(&env, &pool_id);
    client.initialize(&token_0, &token_1, &Q96, &3000u32);
    client.mint(&1u64, &-60, &60, &1_000_000u128);

    // oracle-adapter: pool is the registered pool allowed to write.
    OracleAdapterClient::new(&env, &oracle_id).initialize(&pool_id);
    client.set_oracle(&oracle_id);

    (env, pool_id, oracle_id, token_0, token_1)
}

// ── Tick bitmap ───────────────────────────────────────────────────────────────

#[test]
fn test_flip_tick_marks_and_unmarks() {
    let (env, id, t0, t1) = setup();
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
    let (env, id, t0, t1) = setup();
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
    let (env, id, t0, t1) = setup();
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
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.mint(&2u64, &120, &240, &500_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 0);
}

#[test]
fn test_burn_removes_liquidity() {
    let (env, id, t0, t1) = setup();
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
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.mint(&4u64, &-60, &60, &1_000_000u128);
    client.burn(&4u64, &-60, &60, &400_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 600_000u128);
}

// ── Fee accumulation via swaps ────────────────────────────────────────────────

#[test]
fn test_swap_accrues_fees_with_active_liquidity() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);
    client.mint(&1u64, &-60, &60, &1_000_000u128);

    // fee = amount/1000 = 1_000_000 > liquidity, so fee_growth is non-zero.
    client.swap(&t0, &t1, &1_000_000_000u128, &true, &0u128);
    let state = client.get_state();
    assert!(state.fee_growth_global_0_x128 > 0);
}

#[test]
fn test_swap_does_not_accrue_fees_without_liquidity() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    client.swap(&t0, &t1, &1_000_000u128, &true, &0u128);
    let state = client.get_state();
    assert_eq!(state.fee_growth_global_0_x128, 0);
    assert_eq!(state.fee_growth_global_1_x128, 0);
}

// ── Tick crossing ─────────────────────────────────────────────────────────────

#[test]
fn test_cross_tick_updates_liquidity() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Add liquidity starting at tick 60 (above current)
    client.mint(&1u64, &60, &120, &500_000u128);
    let before = client.get_state().liquidity;

    // Simulate price moving into the range by crossing tick 60
    client.cross_tick(&60, &false);
    let after = client.get_state().liquidity;
    assert!(after > before);
}

// ── Pool state ────────────────────────────────────────────────────────────────

#[test]
fn test_pool_state_exposes_required_fields() {
    let (env, id, t0, t1) = setup();
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
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Move price up
    let new_price = Q96 * 2;
    client.set_price(&new_price);
    let state = client.get_state();
    assert_eq!(state.sqrt_price_x96, new_price);
    assert!(state.tick > 0);
}

#[test]
fn test_swap_moves_price() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);
    client.mint(&1u64, &-60, &60, &1_000_000u128);

    client.swap(&t0, &t1, &1_000_000u128, &true, &0u128);
    let state = client.get_state();
    assert!(
        state.sqrt_price_x96 < Q96,
        "selling token0 must decrease the sqrt price"
    );
}

// ── NFT position lifecycle (simulated) ───────────────────────────────────────

#[test]
fn test_full_lp_lifecycle() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // 1. Add liquidity
    let mint_res = client.mint(&1u64, &-60, &60, &1_000_000u128);
    assert!(mint_res.amount_0 > 0 || mint_res.amount_1 > 0);
    assert_eq!(client.get_state().liquidity, 1_000_000u128);

    // 2. Swap — records an oracle observation and moves the price slightly
    // (small enough that the tick stays inside the position range).
    client.swap(&t0, &t1, &1_000u128, &true, &0u128);
    let state_after_swap = client.get_state();
    assert!(state_after_swap.sqrt_price_x96 < Q96);

    // 3. Remove full liquidity
    let burn_res = client.burn(&1u64, &-60, &60, &1_000_000u128);
    assert!(burn_res.amount_0 > 0 || burn_res.amount_1 > 0);
    assert_eq!(client.get_state().liquidity, 0);
}

// ── Empty / Graceful handling ──────────────────────────────────────────────

#[test]
fn test_collect_returns_zero_for_nonexistent_position() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Try to collect from a position that was never created
    let result = client.collect(&999u64, &-60, &60);
    assert_eq!(result.amount_0, 0);
    assert_eq!(result.amount_1, 0);
}

#[test]
fn test_empty_pool_with_zero_liquidity() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Pool starts with zero liquidity
    let state = client.get_state();
    assert_eq!(state.liquidity, 0);

    // Minting out-of-range keeps liquidity at zero
    client.mint(&1u64, &120, &240, &500_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 0);
}

#[test]
fn test_collect_after_position_burn() {
    let (env, id, t0, t1) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    // Add and then fully burn liquidity
    client.mint(&1u64, &-60, &60, &1_000_000u128);
    client.burn(&1u64, &-60, &60, &1_000_000u128);

    // Trying to collect from the burned position returns zero
    let result = client.collect(&1u64, &-60, &60);
    assert_eq!(result.amount_0, 0);
    assert_eq!(result.amount_1, 0);
}

// ── Oracle adapter integration ────────────────────────────────────────────────

#[test]
fn test_swap_records_oracle_observation() {
    let (env, pool_id, oracle_id, token_0, token_1) = setup_with_oracle();
    let client = PoolClient::new(&env, &pool_id);
    let oracle = OracleAdapterClient::new(&env, &oracle_id);

    client.swap(&token_0, &token_1, &1_000_000u128, &true, &0u128);

    assert_eq!(
        oracle.get_observation_count(),
        1,
        "pool swap must record exactly one observation with the oracle adapter"
    );
}

#[test]
fn test_swap_records_twap_observation() {
    let (env, pool_id, oracle_id, token_0, token_1) = setup_with_oracle();
    let client = PoolClient::new(&env, &pool_id);
    let oracle = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.swap(&token_0, &token_1, &1_000_000u128, &true, &0u128);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.swap(&token_0, &token_1, &1_000_000u128, &true, &0u128);

    let twap = oracle.get_twap(&100);
    assert!(
        twap > 0,
        "TWAP must reflect the post-swap price, got {twap}"
    );
}

#[test]
fn test_swap_without_oracle_wiring_still_succeeds() {
    // No oracle configured: the swap must still work (loud failure only when
    // someone actually asks for a TWAP that was never recorded).
    let env = Env::default();
    env.mock_all_auths();
    let pool_id = env.register(Pool, ());
    let token_0 = Address::generate(&env);
    let token_1 = Address::generate(&env);

    let client = PoolClient::new(&env, &pool_id);
    client.initialize(&token_0, &token_1, &Q96, &3000u32);
    client.mint(&1u64, &-60, &60, &1_000_000u128);

    let result = client.swap(&token_0, &token_1, &1_000_000u128, &true, &0u128);
    assert!(result.amount_out > 0);
    assert_eq!(result.amount_in, 1_000_000u128);
}
