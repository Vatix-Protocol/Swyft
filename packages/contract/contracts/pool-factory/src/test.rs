//! Tests for the pool-factory contract.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env,
};

fn setup_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token0 = Address::generate(&env);
    let token1 = Address::generate(&env);
    (env, admin, token0, token1)
}

fn init_factory(env: &Env, admin: &Address) -> Address {
    let factory_id = env.register(PoolFactory, ());
    let client = PoolFactoryClient::new(env, &factory_id);
    client.initialize(admin);
    factory_id
}

#[test]
fn test_initialize_sets_admin() {
    let (env, admin, _, _) = setup_env();
    let factory_id = init_factory(&env, &admin);
    let client = PoolFactoryClient::new(&env, &factory_id);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_create_pool_clears_loading_state() {
    let (env, admin, token0, token1) = setup_env();
    let factory_id = init_factory(&env, &admin);
    let client = PoolFactoryClient::new(&env, &factory_id);

    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    let fee_tier: u32 = 30;

    assert!(!client.get_is_loading());

    let pool = client.create_pool(&token0, &token1, &fee_tier, &wasm_hash);

    // Loading must be cleared on a successful return.
    assert!(!client.get_is_loading());
    assert_eq!(client.get_pool(&token0, &token1, &fee_tier), Some(pool.clone()));
}

#[test]
fn test_create_pool_clears_loading_state_on_revert() {
    let (env, admin, token0, token1) = setup_env();
    let factory_id = init_factory(&env, &admin);
    let client = PoolFactoryClient::new(&env, &factory_id);

    // A wasm hash that is not installed will make the deployer trap.
    let bad_wasm_hash = BytesN::from_array(&env, &[0xffu8; 32]);
    let fee_tier: u32 = 30;

    assert!(!client.get_is_loading());

    let result = client.try_create_pool(&token0, &token1, &fee_tier, &bad_wasm_hash);
    assert!(result.is_err());

    // Even though the deploy trapped, the Loading flag must not be left set.
    assert!(!client.get_is_loading());
    assert_eq!(client.get_pool(&token0, &token1, &fee_tier), None);
}

#[test]
fn test_create_pool_duplicate_rejected() {
    let (env, admin, token0, token1) = setup_env();
    let factory_id = init_factory(&env, &admin);
    let client = PoolFactoryClient::new(&env, &factory_id);

    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    let fee_tier: u32 = 30;

    let first_pool = client.create_pool(&token0, &token1, &fee_tier, &wasm_hash);
    assert!(!client.get_is_loading());

    let result = client.try_create_pool(&token0, &token1, &fee_tier, &wasm_hash);
    assert_eq!(result, Err(Ok(FactoryError::DuplicatePool)));

    // The stored pool address must be unchanged and Loading must be cleared.
    assert_eq!(client.get_pool(&token0, &token1, &fee_tier), Some(first_pool));
    assert!(!client.get_is_loading());
}
