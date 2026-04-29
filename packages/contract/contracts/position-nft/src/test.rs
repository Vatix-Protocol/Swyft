#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, IntoVal,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PositionNft);
    let minter = Address::generate(&env);
    let pool = Address::generate(&env);
    let user = Address::generate(&env);

    let client = PositionNftClient::new(&env, &contract_id);
    client.initialize(&minter);

    (env, contract_id, minter, pool, user)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_minter_and_next_id() {
    let (env, contract_id, _minter, _pool, _user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    assert_eq!(client.next_id(), 0u64);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_panics() {
    let (env, contract_id, minter, _pool, _user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    client.initialize(&minter); // second call must panic
}

// ── mint ──────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_returns_incrementing_ids() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);

    let id0 = client.mint(&user, &pool, &-100i32, &100i32, &1_000u128);
    let id1 = client.mint(&user, &pool, &-200i32, &200i32, &2_000u128);

    assert_eq!(id0, 0u64);
    assert_eq!(id1, 1u64);
    assert_eq!(client.next_id(), 2u64);
}

#[test]
fn test_mint_stores_correct_metadata() {
    let (env, contract_id, _minter, pool, user) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
    let client = PositionNftClient::new(&env, &contract_id);

    let id = client.mint(&user, &pool, &-500i32, &500i32, &42_000u128);
    let meta = client.get_position(&id).unwrap();

    assert_eq!(meta.owner, user);
    assert_eq!(meta.pool, pool);
    assert_eq!(meta.tick_lower, -500);
    assert_eq!(meta.tick_upper, 500);
    assert_eq!(meta.liquidity, 42_000u128);
    assert_eq!(meta.created_at, 1_700_000_000u64);
}

#[test]
fn test_mint_emits_transfer_event() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);

    let id = client.mint(&user, &pool, &0i32, &100i32, &500u128);

    let events = env.events().all();
    // Last event should be the Transfer
    let last = events.last().unwrap();
    // topic[0] == "Transfer", data == (None, Some(user), id)
    assert_eq!(
        last,
        (
            contract_id.clone(),
            vec![&env, Symbol::new(&env, "Transfer").into_val(&env)],
            (Option::<Address>::None, Some(user), id).into_val(&env),
        )
    );
}

// ── owner_of ──────────────────────────────────────────────────────────────────

#[test]
fn test_owner_of_returns_correct_owner() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);

    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    assert_eq!(client.owner_of(&id), user);
}

#[test]
#[should_panic(expected = "token not found")]
fn test_owner_of_nonexistent_panics() {
    let (env, contract_id, ..) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    client.owner_of(&999u64);
}

// ── transfer ─────────────────────────────────────────────────────────────────

#[test]
fn test_transfer_changes_owner() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);

    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    client.transfer(&user, &recipient, &id);

    assert_eq!(client.owner_of(&id), recipient);
}

#[test]
fn test_transfer_emits_transfer_event() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);

    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    client.transfer(&user, &recipient, &id);

    let events = env.events().all();
    let last = events.last().unwrap();
    assert_eq!(
        last,
        (
            contract_id.clone(),
            vec![&env, Symbol::new(&env, "Transfer").into_val(&env)],
            (Some(user), Some(recipient), id).into_val(&env),
        )
    );
}

#[test]
#[should_panic(expected = "not owner")]
fn test_transfer_by_non_owner_panics() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    let attacker = Address::generate(&env);
    let recipient = Address::generate(&env);

    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    client.transfer(&attacker, &recipient, &id);
}

#[test]
#[should_panic(expected = "token not found")]
fn test_transfer_nonexistent_panics() {
    let (env, contract_id, _minter, _pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);
    client.transfer(&user, &recipient, &999u64);
}

// ── burn ──────────────────────────────────────────────────────────────────────

#[test]
fn test_burn_removes_position() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);

    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    client.burn(&id);

    assert!(client.get_position(&id).is_none());
}

#[test]
fn test_burn_emits_transfer_event() {
    let (env, contract_id, _minter, pool, user) = setup();
    let client = PositionNftClient::new(&env, &contract_id);

    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    client.burn(&id);

    let events = env.events().all();
    let last = events.last().unwrap();
    assert_eq!(
        last,
        (
            contract_id.clone(),
            vec![&env, Symbol::new(&env, "Transfer").into_val(&env)],
            (Some(user), Option::<Address>::None, id).into_val(&env),
        )
    );
}

#[test]
#[should_panic(expected = "token not found")]
fn test_burn_nonexistent_panics() {
    let (env, contract_id, ..) = setup();
    let client = PositionNftClient::new(&env, &contract_id);
    client.burn(&999u64);
}

// ── minter-only auth ──────────────────────────────────────────────────────────

#[test]
fn test_mint_requires_minter_auth() {
    let (env, contract_id, minter, pool, user) = setup();
    // Do NOT mock all auths — check the recorded auth tree manually
    env.mock_all_auths();
    let client = PositionNftClient::new(&env, &contract_id);
    client.mint(&user, &pool, &0i32, &60i32, &100u128);

    // The minter address must appear in the authorised invocations
    let auths = env.auths();
    let minter_auth = auths.iter().any(|(addr, _)| *addr == minter);
    assert!(minter_auth, "minter auth was not required");
}

#[test]
fn test_burn_requires_minter_auth() {
    let (env, contract_id, minter, pool, user) = setup();
    env.mock_all_auths();
    let client = PositionNftClient::new(&env, &contract_id);
    let id = client.mint(&user, &pool, &0i32, &60i32, &100u128);
    client.burn(&id);

    let auths = env.auths();
    let minter_auth = auths.iter().any(|(addr, _)| *addr == minter);
    assert!(minter_auth, "minter auth was not required for burn");
}
