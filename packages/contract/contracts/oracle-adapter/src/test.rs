#![cfg(test)]
//! Unit tests for the oracle-adapter circular observation buffer.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

use crate::{OracleAdapter, OracleAdapterClient};

const Q96: u128 = 1u128 << 96;

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let oracle_id = env.register(OracleAdapter, ());
    let pool = Address::generate(&env);
    let client = OracleAdapterClient::new(&env, &oracle_id);
    client.initialize(&pool);
    (env, oracle_id, pool)
}

#[test]
fn test_initialize_sets_registered_pool() {
    let (env, oracle_id, pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);
    assert_eq!(client.get_pool(), pool);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_initialize_twice_panics() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);
    let other = Address::generate(&env);
    client.initialize(&other);
}

#[test]
fn test_write_observation_records_cumulative_values() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);

    assert_eq!(client.get_observation_count(), 1);

    let obs = client.get_observation(&0);
    assert_eq!(obs.timestamp, 1_000);
    assert_eq!(obs.cumulative_sqrt_price, 0); // first observation seeds the buffer
    assert_eq!(obs.cumulative_liquidity, 0);
}

#[test]
fn test_get_twap_averages_across_window() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.write_observation(&(Q96 / 2), &2_000u128);

    assert_eq!(client.get_observation_count(), 2);

    // Price was Q96/2 for the entire window [1000, 2000].
    let twap = client.get_twap(&1_000);
    assert_eq!(twap, Q96 / 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_get_twap_insufficient_history() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);

    // Only one observation — not enough to compute a TWAP.
    client.get_twap(&100);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_get_twap_window_too_large() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.write_observation(&(Q96 / 2), &2_000u128);

    // Window extends before the oldest recorded observation.
    client.get_twap(&2_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_get_twap_stale_observation() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.write_observation(&(Q96 / 2), &2_000u128);

    assert_eq!(client.get_observation_count(), 2);

    // Advance the ledger past the newest observation without writing a new
    // one. The requested window ends at the current ledger time (3000), which
    // is after the newest observation (2000), so the tail of the window has no
    // covering observation and the contract must reject with StaleObservation.
    env.ledger().with_mut(|l| l.timestamp = 3_000);
    client.get_twap(&1_000);
}

#[test]
fn test_write_observation_requires_registered_pool() {
    // No mock_all_auths: the caller must actually be the registered pool.
    let env = Env::default();
    let oracle_id = env.register(OracleAdapter, ());
    let pool = Address::generate(&env);
    let client = OracleAdapterClient::new(&env, &oracle_id);
    client.initialize(&pool);

    let result = client.try_write_observation(&Q96, &1_000u128);
    assert!(
        result.is_err(),
        "write_observation must reject callers that are not the registered pool"
    );
}

#[test]
fn test_write_observation_wraps_circular_buffer() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    // A handful of observations must keep the counter monotonic and let the
    // latest write be read back from its absolute index (slot = index % 65535).
    for i in 0..100u32 {
        env.ledger().with_mut(|l| l.timestamp = 1_000 + i as u64);
        client.write_observation(&Q96, &1_000u128);
    }

    assert_eq!(client.get_observation_count(), 100);
    let latest = client.get_observation(&99);
    assert_eq!(latest.timestamp, 1_099);
}

#[test]
fn test_first_observation_records_zero_cumulatives() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    assert_eq!(client.get_observation_count(), 0);

    env.ledger().with_mut(|l| l.timestamp = 5_000);
    client.write_observation(&(Q96 * 3), &7_777u128);

    // count == 0 before the write, so there is no previous observation to
    // accumulate from regardless of the price and liquidity supplied.
    assert_eq!(client.get_observation_count(), 1);
    let obs = client.get_observation(&0);
    assert_eq!(obs.timestamp, 5_000);
    assert_eq!(obs.cumulative_sqrt_price, 0);
    assert_eq!(obs.cumulative_liquidity, 0);
}

#[test]
fn test_write_observation_same_timestamp_is_noop() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);

    env.ledger().with_mut(|l| l.timestamp = 1_010);
    client.write_observation(&(Q96 / 2), &2_000u128);

    // Second write in the same ledger: zero elapsed time, so it is skipped.
    client.write_observation(&(Q96 * 4), &9_000u128);

    assert_eq!(client.get_observation_count(), 2);

    let latest = client.get_observation(&1);
    assert_eq!(latest.timestamp, 1_010);
    assert_eq!(latest.cumulative_sqrt_price, (Q96 / 2) * 10);
    assert_eq!(latest.cumulative_liquidity, 2_000u128 * 10);

    // The skipped write did not claim the next slot: the next distinct
    // timestamp lands in slot 2 and accumulates from slot 1.
    env.ledger().with_mut(|l| l.timestamp = 1_015);
    client.write_observation(&Q96, &3_000u128);

    assert_eq!(client.get_observation_count(), 3);
    let next = client.get_observation(&2);
    assert_eq!(next.timestamp, 1_015);
    assert_eq!(next.cumulative_sqrt_price, (Q96 / 2) * 10 + Q96 * 5);
    assert_eq!(next.cumulative_liquidity, 2_000u128 * 10 + 3_000u128 * 5);
}

#[test]
fn test_first_two_writes_at_same_timestamp_keep_single_observation() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.write_observation(&Q96, &1_000u128);
    client.write_observation(&(Q96 / 2), &2_000u128);

    assert_eq!(client.get_observation_count(), 1);
    let obs = client.get_observation(&0);
    assert_eq!(obs.timestamp, 1_000);
    assert_eq!(obs.cumulative_sqrt_price, 0);
    assert_eq!(obs.cumulative_liquidity, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_write_observation_decreasing_timestamp_panics() {
    let (env, oracle_id, _pool) = setup();
    let client = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.write_observation(&Q96, &1_000u128);

    env.ledger().with_mut(|l| l.timestamp = 1_999);
    client.write_observation(&Q96, &1_000u128);
}
