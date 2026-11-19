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
