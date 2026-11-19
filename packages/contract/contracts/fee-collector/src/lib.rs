#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

#[cfg(test)]
mod test;

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
        if env.storage().instance().has(&KEY_ADMIN) {
            panic!("fee collector already initialized");
        }
        admin.require_auth();
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

#[cfg(test)]
mod fee_switch_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, Env};

    fn setup(env: &Env) -> (FeeCollectorClient<'_>, Address, Address, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, FeeCollector);
        let client = FeeCollectorClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        let pool = Address::generate(env);
        client.initialize(&admin, &treasury);
        client.set_authorized_pool(&pool, &true);

        let token_admin = Address::generate(env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = token::StellarAssetClient::new(env, &token_id);
        token_client.mint(&pool, &1_000i128);

        (client, admin, treasury, pool, token_id)
    }

    #[test]
    fn fee_switch_defaults_to_off() {
        let env = Env::default();
        let (client, _admin, _treasury, _pool, _token) = setup(&env);
        assert!(!client.is_fee_on());
    }

    #[test]
    fn deposit_is_noop_while_fee_switch_off() {
        let env = Env::default();
        let (client, _admin, _treasury, pool, token_id) = setup(&env);
        let token_client = token::Client::new(&env, &token_id);

        let before = token_client.balance(&pool);
        client.deposit_protocol_fees(&token_id, &pool, &100i128);

        assert_eq!(token_client.balance(&pool), before);
        assert_eq!(client.get_balance(&token_id), 0i128);
    }

    #[test]
    fn deposit_transfers_when_fee_switch_on() {
        let env = Env::default();
        let (client, _admin, _treasury, pool, token_id) = setup(&env);
        let token_client = token::Client::new(&env, &token_id);

        client.set_fee_switch(&true);
        assert!(client.is_fee_on());

        let before = token_client.balance(&pool);
        client.deposit_protocol_fees(&token_id, &pool, &100i128);

        assert_eq!(token_client.balance(&pool), before - 100i128);
        assert_eq!(client.get_balance(&token_id), 100i128);
    }
}
