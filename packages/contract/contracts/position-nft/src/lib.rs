#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec};

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
    /// One-time initialisation. Must be called before any other function.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `minter`: Address of the pool contract that is authorised to mint and
    ///   burn position NFTs.  All subsequent `mint` and `burn` calls must be
    ///   authorised by this address.
    ///
    /// # Panics
    /// Panics with `"already initialized"` if called more than once.
    pub fn initialize(env: Env, minter: Address) {
        if env.storage().instance().has(&DataKey::Minter) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Minter, &minter);
        env.storage().instance().set(&DataKey::NextId, &0u64);
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
    /// Panics if the caller is not the authorised minter, or if the token ID
    /// counter would overflow `u64::MAX`.
    pub fn mint(
        env: Env,
        owner: Address,
        pool: Address,
        tick_lower: i32,
        tick_upper: i32,
        liquidity: u128,
    ) -> u64 {
        require_minter(&env);

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0u64);

        // Check for overflow
        if id == u64::MAX {
            return Err(PositionNftError::Overflow);
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
    /// The [`Address`] of the current owner.
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

    /// Returns full metadata for a token.
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    /// - `token_id`: ID of the token to query.
    ///
    /// # Returns
    /// `Some(`[`PositionMetadata`]`)` if the token exists, or `None` if it has
    /// been burned or was never minted.
    pub fn get_position(env: Env, token_id: u64) -> Option<PositionMetadata> {
        env.storage().persistent().get(&DataKey::Position(token_id))
    }

    /// Returns the next token ID (== total minted, since IDs are never reused).
    ///
    /// # Parameters
    /// - `env`: Soroban execution environment.
    ///
    /// # Returns
    /// A `u64` equal to the number of tokens that have ever been minted.
    /// Because IDs start at `0` and increment by `1` on each mint, this value
    /// is also the ID that will be assigned to the *next* mint call.
    pub fn next_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0u64)
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
    Ok(())
}

/// Emit a Transfer event compatible with the SDK / frontend.
/// `from = None` means mint (from zero), `to = None` means burn (to zero).
fn emit_transfer(env: &Env, from: Option<Address>, to: Option<Address>, token_id: u64) {
    env.events().publish(
        (Symbol::new(env, "Transfer"),),
        (from, to, token_id),
    );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test;
