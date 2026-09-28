#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn initialize_requires_admin_authorization() {
    let env = Env::default();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    assert!(client.try_initialize(&admin, &treasury).is_err());
    assert!(client.try_get_admin().is_err());

    env.mock_all_auths();
    client.initialize(&admin, &treasury);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_treasury(), treasury);
}

#[test]
fn initialize_cannot_reset_withdrawal_authority_or_treasury() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let attacker = Address::generate(&env);
    let attacker_treasury = Address::generate(&env);

    client.initialize(&admin, &treasury);
    assert!(client
        .try_initialize(&attacker, &attacker_treasury)
        .is_err());
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_treasury(), treasury);
}

