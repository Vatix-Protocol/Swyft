#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PositionMetadata {
    pub owner: Address,
    pub pool: Address,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
}

#[contract]
pub struct PositionNft;

#[contractimpl]
impl PositionNft {
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "position_nft")
    }

    pub fn initialize(env: Env, minter: Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "minter"), &minter);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "next_id"), &0u64);
    }

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
            .get(&Symbol::new(&env, "next_id"))
            .unwrap_or(0u64);

        let meta = PositionMetadata {
            owner,
            pool,
            tick_lower,
            tick_upper,
            liquidity,
        };
        env.storage().persistent().set(&id, &meta);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "next_id"), &(id + 1));
        id
    }

    pub fn burn(env: Env, token_id: u64) {
        require_minter(&env);
        env.storage().persistent().remove(&token_id);
    }

    pub fn get_position(env: Env, token_id: u64) -> Option<PositionMetadata> {
        env.storage().persistent().get(&token_id)
    }

    pub fn total_supply(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "next_id"))
            .unwrap_or(0u64)
    }
}

fn require_minter(env: &Env) {
    let minter: Address = env
        .storage()
        .instance()
        .get(&Symbol::new(env, "minter"))
        .unwrap();
    minter.require_auth();
}
