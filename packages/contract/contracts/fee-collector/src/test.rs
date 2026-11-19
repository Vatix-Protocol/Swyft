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

#[test]
fn collect_protocol_fees_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let second_admin = Address::generate(&env);
    let second_treasury = Address::generate(&env);

    client.initialize(&admin, &treasury);

    assert!(client
        .try_initialize(&second_admin, &second_treasury)
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
fn initialize_cannot_be_repeated() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let second_admin = Address::generate(&env);
    let second_treasury = Address::generate(&env);

    client.initialize(&admin, &treasury);

    assert!(client
        .try_initialize(&second_admin, &second_treasury)
        .is_err());

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_treasury(), treasury);
}

#[test]
fn collect_protocol_fees_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin, &treasury);
    client.set_balance(&1000);

    // A non-admin caller must not be able to move the balance.
    env.set_auths(&[]);
    assert!(client.try_collect_protocol_fees().is_err());
    assert_eq!(client.get_balance(), 1000);
}

#[test]
fn collect_protocol_fees_sends_full_balance_and_zeroes_it() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin, &treasury);
    client.set_balance(&1000);

    client.collect_protocol_fees();
    assert_eq!(client.get_balance(), 0);
}

#[test]
fn collect_protocol_fees_with_zero_balance_returns_without_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FeeCollector);
    let client = FeeCollectorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin, &treasury);
    assert_eq!(client.get_balance(), 0);

    client.collect_protocol_fees();
    assert_eq!(client.get_balance(), 0);
}
