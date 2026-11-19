#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, symbol_short, Address, Env, Symbol, Vec};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PositionNftError {
    NotMinter = 1,
    Overflow = 2,
    NotFound = 3,
    ZeroLiquidity = 4,
    InvalidTickRange = 5,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Minter,
    NextId,
    Position(u64),
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PositionMetadata {
    pub owner: Address,
    pub pool: Address,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
    pub created_at: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PositionNft;

#[contractimpl]
impl PositionNft {
    /// One-time initialization. The admin authorizes the pool minter link.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `admin`: Account authorizing the NFT-to-pool configuration.
    /// - `minter`: Address of the pool contract that is authorised to mint and
    ///   burn position NFTs.  All subsequent `mint` and `burn` calls must be
    ///   authorised by this address.
    ///
    /// # Panics
    /// Panics with `"already initialized"` if called more than once.
    pub fn initialize(env: Env, admin: Address, minter: Address) {
        if env.storage().instance().has(&DataKey::Minter) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Minter, &minter);
        env.storage().instance().set(&DataKey::NextId, &0u64);
    }

    /// Returns the pool contract authorized to mint, update, and burn positions.
    pub fn get_minter(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Minter)
            .expect("not initialized")
    }

    /// Mint a new position NFT. Only callable by the minter (pool contract).
    ///
    /// Creates a [`PositionMetadata`] record keyed by the new token ID and
    /// emits a `Transfer(None → owner, token_id)` event.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `owner`: Address that will own the newly minted position.
    /// - `pool`: Address of the pool contract this position belongs to.
    /// - `tick_lower`: Lower tick boundary of the concentrated-liquidity range.
    /// - `tick_upper`: Upper tick boundary of the concentrated-liquidity range.
    /// - `liquidity`: Initial liquidity amount deposited into the position.
    ///
    /// # Returns
    /// The newly assigned token ID (`u64`).  Token IDs are monotonically
    /// increasing and are never reused after a burn.
    ///
    /// # Panics
    /// Panics if the caller is not the authorised minter, if `liquidity` is
    /// zero (`ZeroLiquidity`), if `tick_lower >= tick_upper`
    /// (`InvalidTickRange`), or if the token ID counter would overflow
    /// `u64::MAX`.
    pub fn mint(
        env: Env,
        owner: Address,
        pool: Address,
        tick_lower: i32,
        tick_upper: i32,
        liquidity: u128,
    ) -> u64 {
        require_minter(&env);

        if liquidity == 0 {
            env.panic_with_error(soroban_sdk::Error::from_contract_error(
                PositionNftError::ZeroLiquidity as u32,
            ));
        }

        if tick_lower >= tick_upper {
            env.panic_with_error(soroban_sdk::Error::from_contract_error(
                PositionNftError::InvalidTickRange as u32,
            ));
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0u64);

        // Check for overflow
        if id == u64::MAX {
            env.panic_with_error(soroban_sdk::Error::from_contract_error(PositionNftError::Overflow as u32));
        }

        let created_at = env.ledger().timestamp();

        let meta = PositionMetadata {
            owner: owner.clone(),
            pool,
            tick_lower,
            tick_upper,
            liquidity,
            created_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Position(id), &meta);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        // Transfer event: zero address → owner
        emit_transfer(&env, None, Some(owner), id);

        id
    }

    /// Burn a position NFT. Only callable by the minter (pool contract).
    ///
    /// Removes the [`PositionMetadata`] record for `token_id` from persistent
    /// storage and emits a `Transfer(owner → None, token_id)` event.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `token_id`: ID of the token to burn.  Must exist in storage.
    ///
    /// # Returns
    /// `()` — no return value.
    ///
    /// # Panics
    /// Panics if the caller is not the authorised minter, or if `token_id`
    /// does not exist (`"token not found"`).
    pub fn burn(env: Env, token_id: u64) {
        require_minter(&env);

        let meta: PositionMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Position(token_id))
            .expect("token not found");

        env.storage().persistent().remove(&DataKey::Position(token_id));

        // Transfer event: owner → zero address
        emit_transfer(&env, Some(meta.owner), None, token_id);
    }

    /// Update liquidity metadata for an existing position. Only the minter
    /// may update it, so a partial pool withdrawal preserves the same NFT.
    pub fn update_liquidity(env: Env, token_id: u64, liquidity: u128) {
        require_minter(&env);
        if liquidity == 0 {
            env.panic_with_error(soroban_sdk::Error::from_contract_error(
                PositionNftError::ZeroLiquidity as u32,
            ));
        }

        let mut meta: PositionMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Position(token_id))
            .expect("token not found");
        meta.liquidity = liquidity;
        env.storage()
            .persistent()
            .set(&DataKey::Position(token_id), &meta);
    }

    /// Transfer a position NFT between addresses. Callable by the current owner.
    ///
    /// Updates the `owner` field of the [`PositionMetadata`] record and emits
    /// a `Transfer(from → to, token_id)` event.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `from`: Current owner of the token.  Must authorise this call.
    /// - `to`: Recipient address that will become the new owner.
    /// - `token_id`: ID of the token to transfer.  Must exist in storage.
    ///
    /// # Returns
    /// `()` — no return value.
    ///
    /// # Panics
    /// Panics if `from` does not authorise the call, if `token_id` does not
    /// exist (`"token not found"`), or if `from` is not the current owner
    /// (`"not owner"`).
    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) {
        from.require_auth();

        let mut meta: PositionMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Position(token_id))
            .expect("token not found");

        if meta.owner != from {
            panic!("not owner");
        }

        meta.owner = to.clone();
        env.storage().persistent().set(&DataKey::Position(token_id), &meta);

        emit_transfer(&env, Some(from), Some(to), token_id);
    }

    /// Returns the current owner of a token.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `token_id`: ID of the token to query.
    ///
    /// # Returns
    /// The [`Address`] that currently owns `token_id`.
    ///
    /// # Panics
    /// Panics if `token_id` does not exist (`"token not found"`).
    pub fn owner_of(env: Env, token_id: u64) -> Address {
        let meta: PositionMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Position(token_id))
            .expect("token not found");
        meta.owner
    }

    /// Returns the full [`PositionMetadata`] record for a token.
    ///
    /// # Panics
    /// Panics if `token_id` does not exist (`"token not found"`).
    pub fn get_position(env: Env, token_id: u64) -> PositionMetadata {
        env.storage()
            .persistent()
            .get(&DataKey::Position(token_id))
            .expect("token not found")
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn require_minter(env: &Env) {
    let minter: Address = env
        .storage()
        .instance()
        .get(&DataKey::Minter)
        .expect("not initialized");
    minter.require_auth();
}

fn emit_transfer(env: &Env, from: Option<Address>, to: Option<Address>, token_id: u64) {
    let topics = (symbol_short!("transfer"), from, to);
    env.events().publish(topics, token_id);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _};
    use soroban_sdk::{IntoVal, TryFromVal};

    fn setup() -> (Env, PositionNftClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, PositionNft);
        let client = PositionNftClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);
        client.initialize(&admin, &minter);
        (env, client, admin, minter)
    }

    #[test]
    fn burn_requires_minter() {
        let (env, client, _admin, _minter) = setup();
        let owner = Address::generate(&env);
        let pool = Address::generate(&env);

        let id = client.mint(&owner, &pool, &-10i32, &10i32, &1_000u128);

        // Minter can burn an existing id.
        client.burn(&id);

        // A second burn of that id fails because the token is gone.
        let res = client.try_burn(&id);
        assert!(res.is_err());

        // Another address fails the minter check.
        let other = Address::generate(&env);
        let id2 = client.mint(&owner, &pool, &-10i32, &10i32, &1_000u128);
        let res = client
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &other,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "burn",
                    args: (id2,).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_burn(&id2);
        assert!(res.is_err());
    }

    #[test]
    fn burn_emits_transfer_to_none() {
        let (env, client, _admin, _minter) = setup();
        let owner = Address::generate(&env);
        let pool = Address::generate(&env);

        let id = client.mint(&owner, &pool, &-10i32, &10i32, &1_000u128);
        client.burn(&id);

        let events = env.events().all();
        let burn_event = events.last().expect("expected a burn event");
        let topics = burn_event.1;
        assert_eq!(topics.len(), 3);
        assert_eq!(
            Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap(),
            symbol_short!("transfer")
        );
        let from = Option::<Address>::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        let to = Option::<Address>::try_from_val(&env, &topics.get(2).unwrap()).unwrap();
        assert_eq!(from, Some(owner));
        assert_eq!(to, None);
    }
}
