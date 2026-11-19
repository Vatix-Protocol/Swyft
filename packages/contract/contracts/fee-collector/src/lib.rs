#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

#[cfg(test)]
mod test;

// ── Storage keys ─────────────────────────────────────────────────────────────
const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_TREASURY: Symbol = symbol_short!("TREASURY");
const KEY_FEE_ON: Symbol = symbol_short!("FEE_ON");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FeeCollectorError {
    BalanceOverflow = 1,
}

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

        let balance_key = DataKey::Balance(token.clone());
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        let new_balance = balance
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, FeeCollectorError::BalanceOverflow));

        token::Client::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);
        env.storage().persistent().set(&balance_key, &new_balance);
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
mod reinit_test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn initialize_cannot_be_repeated() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, FeeCollector);
        let client = FeeCollectorClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        client.initialize(&admin, &treasury);

        let new_admin = Address::generate(&env);
        let new_treasury = Address::generate(&env);
        let result = client.try_initialize(&new_admin, &new_treasury);
        assert!(result.is_err(), "second initialize must fail");

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_treasury(), treasury);
    }
}

#[cfg(test)]
mod non_positive_fee_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup(env: &Env) -> (FeeCollectorClient<'_>, Address, Address) {
        let contract_id = env.register_contract(None, FeeCollector);
        let client = FeeCollectorClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        client.initialize(&admin, &treasury);
        (client, admin, contract_id)
    }

    #[test]
    fn deposit_zero_amount_is_rejected_and_balance_unchanged() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, _contract_id) = setup(&env);
        let pool = Address::generate(&env);
        let token = Address::generate(&env);

        client.set_authorized_pool(&pool, &true);
        client.set_fee_switch(&true);

        let result = client.try_deposit_protocol_fees(&token, &pool, &0i128);
        assert!(result.is_err());
        assert_eq!(client.get_balance(&token), 0);
    }

    #[test]
    fn deposit_negative_amount_is_rejected_and_balance_unchanged() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, _contract_id) = setup(&env);
        let pool = Address::generate(&env);
        let token = Address::generate(&env);

        client.set_authorized_pool(&pool, &true);
        client.set_fee_switch(&true);

        let result = client.try_deposit_protocol_fees(&token, &pool, &-1i128);
        assert!(result.is_err());
        assert_eq!(client.get_balance(&token), 0);
    }
}

#[cfg(test)]
mod unauthorized_pool_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup(env: &Env) -> (FeeCollectorClient<'_>, Address, Address) {
        let contract_id = env.register_contract(None, FeeCollector);
        let client = FeeCollectorClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        client.initialize(&admin, &treasury);
        (client, admin, contract_id)
    }

    #[test]
    fn unauthorized_pool_cannot_deposit_fees_even_with_switch_on() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, _contract_id) = setup(&env);
        let pool = Address::generate(&env);
        let token = Address::generate(&env);

        // Fee switch is on, but the pool was never authorized.
        client.set_fee_switch(&true);
        assert!(!client.is_authorized_pool(&pool));

        let result = client.try_deposit_protocol_fees(&token, &pool, &100i128);
        assert!(result.is_err());
        // No tokens were transferred into the collector.
        assert_eq!(client.get_balance(&token), 0);
    }

    #[test]
    fn authorized_pool_proceeds_past_auth_check() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, _contract_id) = setup(&env);
        let pool = Address::generate(&env);
        let token = Address::generate(&env);

        client.set_authorized_pool(&pool, &true);
        assert!(client.is_authorized_pool(&pool));

        // Switch is off: authorized pool passes the auth check and the call
        // is a no-op at the switch check (no panic, no balance change).
        client.set_fee_switch(&false);
        client.deposit_protocol_fees(&token, &pool, &100i128);
        assert_eq!(client.get_balance(&token), 0);
    }
}

#[cfg(test)]
mod collect_protocol_fees_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};

    fn setup(env: &Env) -> (FeeCollectorClient<'_>, Address, Address) {
        let contract_id = env.register_contract(None, FeeCollector);
        let client = FeeCollectorClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        client.initialize(&admin, &treasury);
        (client, admin, contract_id)
    }

    /// Registers a Stellar asset contract and funds the collector with `amount`.
    fn fund_collector(env: &Env, contract_id: &Address, amount: i128) -> Address {
        let token_admin = Address::generate(env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        StellarAssetClient::new(env, &token_id).mint(contract_id, &amount);
        token_id
    }

    #[test]
    fn non_admin_call_fails_and_balance_unchanged() {
        let env = Env::default();
        let (client, _admin, contract_id) = setup(&env);
        let token = fund_collector(&env, &contract_id, 500);
        let attacker = Address::generate(&env);

        // Only the attacker authorizes; the admin does not.
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &attacker,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "collect_protocol_fees",
                args: (&token, &attacker).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_collect_protocol_fees(&token, &attacker);
        assert!(result.is_err());
        // Balance is untouched.
        assert_eq!(client.get_balance(&token), 0);
        assert_eq!(TokenClient::new(&env, &token).balance(&contract_id), 500);
    }

    #[test]
    fn admin_call_sends_full_balance_and_stores_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, contract_id) = setup(&env);
        let token = fund_collector(&env, &contract_id, 500);

        // Seed the stored balance to match the funded amount.
        env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::Balance(token.clone()), &500i128);
        });

        client.collect_protocol_fees(&token, &admin);

        assert_eq!(client.get_balance(&token), 0);
        assert_eq!(TokenClient::new(&env, &token).balance(&admin), 500);
        assert_eq!(TokenClient::new(&env, &token).balance(&contract_id), 0);
    }

    #[test]
    fn zero_balance_returns_without_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, contract_id) = setup(&env);
        let token = fund_collector(&env, &contract_id, 0);

        // No stored balance: the call returns early without a transfer.
        client.collect_protocol_fees(&token, &admin);

        assert_eq!(client.get_balance(&token), 0);
        assert_eq!(TokenClient::new(&env, &token).balance(&admin), 0);
        assert_eq!(TokenClient::new(&env, &token).balance(&contract_id), 0);
    }
}
    }
}
