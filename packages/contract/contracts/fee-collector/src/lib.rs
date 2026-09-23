#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

// ── Storage keys ─────────────────────────────────────────────────────────────
const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_TREASURY: Symbol = symbol_short!("TREASURY");
const KEY_FEE_ON: Symbol = symbol_short!("FEE_ON");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    AuthorizedPool(Address),
    Balance(Address),
}

#[contract]
pub struct FeeCollector;

#[contractimpl]
impl FeeCollector {
    /// Returns the contract name — used for post-deploy verification.
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "fee_collector")
    }

    /// Initialises the fee collector with the admin and treasury addresses.
    pub fn initialize(env: Env, admin: Address, treasury: Address) {
        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_TREASURY, &treasury);
        env.storage().instance().set(&KEY_FEE_ON, &false);
    }

    /// Returns the treasury address.
    pub fn get_treasury(env: Env) -> Address {
        env.storage().instance().get(&KEY_TREASURY).unwrap()
    }

    /// Returns the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&KEY_ADMIN).unwrap()
    }

    /// Admin-only: turns fee collection on or off.
    pub fn set_fee_switch(env: Env, on: bool) {
        let admin: Address = env.storage().instance().get(&KEY_ADMIN).unwrap();
        admin.require_auth();
        env.storage().instance().set(&KEY_FEE_ON, &on);
    }

    /// Returns whether the fee switch is currently on.
    pub fn is_fee_on(env: Env) -> bool {
        env.storage().instance().get(&KEY_FEE_ON).unwrap_or(false)
    }

    /// Admin-only: authorizes or revokes a pool contract's ability to deposit
    /// protocol fees.
    pub fn set_authorized_pool(env: Env, pool: Address, authorized: bool) {
        let admin: Address = env.storage().instance().get(&KEY_ADMIN).unwrap();
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedPool(pool), &authorized);
    }

    /// Returns whether `pool` is registered as an authorized fee source.
    pub fn is_authorized_pool(env: Env, pool: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorizedPool(pool))
            .unwrap_or(false)
    }

    /// Called by an authorized pool to push protocol fees into the collector.
    ///
    /// Panics with `unauthorized pool caller` if `from` is not a registered
    /// pool. Is a no-op while the fee switch is off.
    pub fn deposit_protocol_fees(env: Env, token: Address, from: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let authorized: bool = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedPool(from.clone()))
            .unwrap_or(false);
        if !authorized {
            panic!("unauthorized pool caller");
        }

        let fee_on: bool = env.storage().instance().get(&KEY_FEE_ON).unwrap_or(false);
        if !fee_on {
            return;
        }

        from.require_auth();
        token::Client::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        let balance_key = DataKey::Balance(token);
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&balance_key, &(balance + amount));
    }

    /// Returns the accumulated, uncollected balance of `token`.
    pub fn get_balance(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(token))
            .unwrap_or(0)
    }

    /// Admin-only: withdraws the full accumulated balance of `token` to `to`.
    pub fn collect_protocol_fees(env: Env, token: Address, to: Address) {
        let admin: Address = env.storage().instance().get(&KEY_ADMIN).unwrap();
        admin.require_auth();

        let balance_key = DataKey::Balance(token.clone());
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        if balance <= 0 {
            return;
        }

        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &to, &balance);
        env.storage().persistent().set(&balance_key, &0i128);
    }
}
