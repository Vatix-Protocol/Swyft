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
