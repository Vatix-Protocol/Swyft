#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    FeeSwitch,
    Fees(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct FeeConfig {
    pub admin: Address,
    pub fee_switch: bool,
}

#[contract]
pub struct FeeCollector;

#[contractimpl]
impl FeeCollector {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("fee collector already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeSwitch, &false);
    }

    pub fn set_fee_switch(env: Env, enabled: bool) {
        let admin = read_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::FeeSwitch, &enabled);
        env.events()
            .publish((Symbol::new(&env, "FeeSwitchUpdated"), admin), enabled);
    }

    pub fn deposit_protocol_fees(env: Env, token: Address, from: Address, amount: i128) -> i128 {
        if amount <= 0 {
            panic!("fee amount must be positive");
        }

        if !read_fee_switch(&env) {
            return read_fee_balance(&env, &token);
        }

        from.require_auth();

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        let next_amount = read_fee_balance(&env, &token) + amount;
        env.storage()
            .instance()
            .set(&DataKey::Fees(token), &next_amount);

        next_amount
    }

    pub fn collect_protocol_fees(env: Env, token: Address, to: Address) -> i128 {
        let admin = read_admin(&env);
        admin.require_auth();

        let amount = read_fee_balance(&env, &token);
        if amount <= 0 {
            panic!("no protocol fees to collect");
        }

        env.storage()
            .instance()
            .set(&DataKey::Fees(token.clone()), &0i128);

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        env.events()
            .publish((Symbol::new(&env, "FeeCollected"), token, to), amount);

        amount
    }

    pub fn get_fee_config(env: Env) -> FeeConfig {
        FeeConfig {
            admin: read_admin(&env),
            fee_switch: read_fee_switch(&env),
        }
    }

    pub fn get_accumulated_fees(env: Env, token: Address) -> i128 {
        read_fee_balance(&env, &token)
    }
}

fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic!("fee collector not initialized"))
}

fn read_fee_switch(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::FeeSwitch)
        .unwrap_or(false)
}

fn read_fee_balance(env: &Env, token: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::Fees(token.clone()))
        .unwrap_or(0)
}
