#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn setup() -> (Env, Address, FeeCollectorClient<'static>) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin);

    (env, contract_id, client)
}

#[test]
#[should_panic(expected = "unauthorized pool caller")]
fn unauthorized_deposit_fails() {
    let (env, _contract_id, client) = setup();
    let pool = Address::generate(&env);
    let token = Address::generate(&env);

    client.deposit_protocol_fees(&token, &pool, &100);
}

#[test]
fn authorized_pool_deposit_succeeds() {
    let (env, contract_id, client) = setup();
    let pool = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(&env, &token);
    let token_admin_client = token::StellarAssetClient::new(&env, &token);

    env.mock_all_auths();
    token_admin_client.mint(&pool, &1_000);

    client.set_authorized_pool(&pool, &true);
    assert!(client.is_authorized_pool(&pool));

    client.set_fee_switch(&true);
    let next = client.deposit_protocol_fees(&token, &pool, &250);

    assert_eq!(next, 250);
    assert_eq!(client.get_accumulated_fees(&token), 250);
    assert_eq!(token_client.balance(&contract_id), 250);
    assert_eq!(token_client.balance(&pool), 750);

    let treasury = Address::generate(&env);
    let collected = client.collect_protocol_fees(&token, &treasury);
    assert_eq!(collected, 250);
    assert_eq!(token_client.balance(&treasury), 250);
}

#[test]
#[should_panic(expected = "unauthorized pool caller")]
fn revoked_pool_cannot_deposit() {
    let (env, _contract_id, client) = setup();
    let pool = Address::generate(&env);
    let token = Address::generate(&env);

    env.mock_all_auths();
    client.set_authorized_pool(&pool, &true);
    assert!(client.is_authorized_pool(&pool));

    client.set_authorized_pool(&pool, &false);
    assert!(!client.is_authorized_pool(&pool));

    client.deposit_protocol_fees(&token, &pool, &100);
}
