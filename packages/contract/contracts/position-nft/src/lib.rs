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
    /// One-time initialisation. `minter` is the pool contract address.
    pub fn initialize(env: Env, minter: Address) {
        if env.storage().instance().has(&DataKey::Minter) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Minter, &minter);
        env.storage().instance().set(&DataKey::NextId, &0u64);
    }

    /// Mint a new position NFT. Only callable by the minter (pool contract).
    /// Returns the new token ID.
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
    pub fn owner_of(env: Env, token_id: u64) -> Address {
        let meta: PositionMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Position(token_id))
            .expect("token not found");
        meta.owner
    }

    /// Returns full metadata for a token.
    pub fn get_position(env: Env, token_id: u64) -> Option<PositionMetadata> {
        env.storage().persistent().get(&DataKey::Position(token_id))
    }

    /// Returns the next token ID (== total minted, since IDs are never reused).
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
