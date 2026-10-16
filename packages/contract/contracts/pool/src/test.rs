#![cfg(test)]
use soroban_sdk::{testutils::Address as _, token, Address, Env};

use crate::{Pool, PoolClient, Q96};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Pool, ());
    let admin = Address::generate(&env);
    // Register real token contracts so that balances actually move on mint/burn.
    let token_0 = env.register_stellar_asset_contract(admin.clone());
    let token_1 = env.register_stellar_asset_contract(admin.clone());
    let lp = Address::generate(&env);
    (env, contract_id, token_0, token_1, lp)
}

/// Mint an abundant starting balance of both pool tokens to `lp`.
fn fund_lp(env: &Env, token_0: &Address, token_1: &Address, lp: &Address) {
    const INITIAL: i128 = 1_000_000_000_000i128;
    token::StellarAssetClient::new(env, token_0).mint(lp, &INITIAL);
    token::StellarAssetClient::new(env, token_1).mint(lp, &INITIAL);
}

fn init_pool(env: &Env, id: &Address, t0: &Address, t1: &Address) {
    let client = PoolClient::new(env, id);
    client.initialize(t0, t1, &Q96, &3000u32);
}

// ── Initialize validation ─────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_initialize_rejects_zero_sqrt_price() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &0u128, &3000u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_initialize_rejects_price_above_max_tick() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    // A price far above the MAX_TICK bound derives a tick outside the range.
    client.initialize(&t0, &t1, &(u128::MAX / 2), &3000u32);
}

#[test]
fn test_initialize_accepts_valid_price_and_stores_derived_tick() {
    let (env, id, t0, t1, _lp) = setup();
    let client = PoolClient::new(&env, &id);
    client.initialize(&t0, &t1, &Q96, &3000u32);

    let state = client.get_state();
    assert_eq!(state.sqrt_price_x96, Q96);
    assert_eq!(state.tick, 0);
}

// ── Tick bitmap ───────────────────────────────────────────────────────────────

#[test]
fn test_flip_tick_marks_and_unmarks() {
    let (env, id, t0, t1, _lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    let client = PoolClient::new(&env, &id);

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
    init_pool(&env, &id, &t0, &t1);
    let client = PoolClient::new(&env, &id);

    client.flip_tick(&-120, &60);
    let (next, found) = client.next_initialized_tick(&0, &60, &true);
    assert!(found);
    assert_eq!(next, -120);
}

// ── Mint / Burn ───────────────────────────────────────────────────────────────

#[test]
fn test_mint_adds_liquidity_in_range() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    let result = client.mint(&lp, &1u64, &-60, &60, &1_000_000u128);
    assert!(result.amount_0 > 0 || result.amount_1 > 0);

    let state = client.get_state();
    assert_eq!(state.liquidity, 1_000_000u128);
}

#[test]
fn test_mint_out_of_range_does_not_add_active_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    client.mint(&lp, &2u64, &120, &240, &500_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 0);
}

#[test]
fn test_mint_rejects_inverted_tick_range() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    assert!(client.try_mint(&lp, &1u64, &60, &-60, &1_000_000u128).is_err());
    assert_eq!(client.get_state().liquidity, 0);
}

#[test]
fn test_mint_rejects_equal_tick_range() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    assert!(client.try_mint(&lp, &1u64, &60, &60, &1_000_000u128).is_err());
    assert_eq!(client.get_state().liquidity, 0);
}

#[test]
fn test_mint_rejects_zero_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);
    let token_0_client = token::Client::new(&env, &t0);
    let token_1_client = token::Client::new(&env, &t1);

    let lp_0_before = token_0_client.balance(&lp);
    let lp_1_before = token_1_client.balance(&lp);

    assert!(client.try_mint(&lp, &1u64, &-60, &60, &0u128).is_err());
    assert_eq!(client.get_state().liquidity, 0);
    // No token transfer occurred.
    assert_eq!(token_0_client.balance(&lp), lp_0_before);
    assert_eq!(token_1_client.balance(&lp), lp_1_before);
}

#[test]
fn test_burn_removes_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    client.mint(&lp, &3u64, &-60, &60, &1_000_000u128);
    let burn_result = client.burn(&lp, &3u64, &-60, &60, &1_000_000u128);
    assert!(burn_result.amount_0 > 0 || burn_result.amount_1 > 0);

    let state = client.get_state();
    assert_eq!(state.liquidity, 0);
}

#[test]
fn test_partial_burn() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    client.mint(&lp, &4u64, &-60, &60, &1_000_000u128);
    client.burn(&lp, &4u64, &-60, &60, &400_000u128);
    let state = client.get_state();
    assert_eq!(state.liquidity, 600_000u128);
}

// ── Real token transfers ─────────────────────────────────────────────────────

#[test]
fn test_mint_transfers_tokens_from_lp_into_pool() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);
    let token_0_client = token::Client::new(&env, &t0);
    let token_1_client = token::Client::new(&env, &t1);

    let lp_0_before = token_0_client.balance(&lp);
    let lp_1_before = token_1_client.balance(&lp);

    let result = client.mint(&lp, &1u64, &-60, &60, &1_000_000u128);

    // Pool contract now holds the minted amounts.
    assert_eq!(token_0_client.balance(&id) as u128, result.amount_0);
    assert_eq!(token_1_client.balance(&id) as u128, result.amount_1);
    // LP paid exactly the quoted amounts.
    assert_eq!(token_0_client.balance(&lp) as u128, lp_0_before as u128 - result.amount_0);
    assert_eq!(token_1_client.balance(&lp) as u128, lp_1_before as u128 - result.amount_1);
}

#[test]
fn test_burn_transfers_tokens_back_to_lp() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);
    let token_0_client = token::Client::new(&env, &t0);
    let token_1_client = token::Client::new(&env, &t1);

    client.mint(&lp, &1u64, &-60, &60, &1_000_000u128);
    let pool_0_after_mint = token_0_client.balance(&id);
    let pool_1_after_mint = token_1_client.balance(&id);

    let lp_0_before = token_0_client.balance(&lp);
    let lp_1_before = token_1_client.balance(&lp);

    let result = client.burn(&lp, &1u64, &-60, &60, &1_000_000u128);

    // Redeemed tokens returned to the LP.
    assert_eq!(token_0_client.balance(&lp) as u128, lp_0_before as u128 + result.amount_0);
    assert_eq!(token_1_client.balance(&lp) as u128, lp_1_before as u128 + result.amount_1);
    // Pool contract drained of the burned position's principal.
    assert_eq!(token_0_client.balance(&id) as u128, pool_0_after_mint as u128 - result.amount_0);
    assert_eq!(token_1_client.balance(&id) as u128, pool_1_after_mint as u128 - result.amount_1);
}

// ── Fee accumulation ──────────────────────────────────────────────────────────

#[test]
fn test_fees_accumulate_with_active_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);
    client.mint(&lp, &1u64, &-60, &60, &1_000_000u128);

    // fee = amount/1000 = 1_000_000 > liquidity, so fee_growth is non-zero.
    client.swap(&t0, &t1, &1_000_000_000u128, &true, &0u128);
    let state = client.get_state();
    assert!(state.fee_growth_global_0_x128 > 0);
}

#[test]
fn test_fees_do_not_accumulate_without_liquidity() {
    let (env, id, t0, t1, _lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    let client = PoolClient::new(&env, &id);

    client.swap(&t0, &t1, &1_000_000u128, &true, &0u128);
    let state = client.get_state();
    assert_eq!(state.fee_growth_global_0_x128, 0);
    assert_eq!(state.fee_growth_global_1_x128, 0);
}

// ── Tick crossing ─────────────────────────────────────────────────────────────

#[test]
fn test_cross_tick_updates_liquidity() {
    let (env, id, t0, t1, lp) = setup();
    init_pool(&env, &id, &t0, &t1);
    fund_lp(&env, &t0, &t1, &lp);
    let client = PoolClient::new(&env, &id);

    // Add liquidity starting at tick 60 (above current)
    client.mint(&lp, &1u64, &60, &120, &500_000u128);
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
    init_pool(&env, &id, &t0, &t1);
    let client = PoolClient::new(&env, &id);

    let state = client.get_state();
    assert_eq!(state.sqrt_price_x96, Q96);
    assert_eq!(state.tick, 0);
    assert_eq!(state.liquidity, 0);
    assert_eq!(state.fee_growth_global_0_x128, 0);
    assert_eq!(state.fee_growth_global_1_x128, 0);
}
