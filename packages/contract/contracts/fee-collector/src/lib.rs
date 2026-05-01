#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

#[contract]
pub struct FeeCollector;

#[contractimpl]
impl FeeCollector {
    /// Returns the contract name — used for post-deploy verification.
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "fee_collector")
    }

    /// Initialises the fee collector with the treasury address.
    pub fn initialize(env: Env, treasury: Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "treasury"), &treasury);
    }

    /// Returns the treasury address.
    pub fn get_treasury(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "treasury"))
            .unwrap()
    }
}
