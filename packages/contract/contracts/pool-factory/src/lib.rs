#![no_std]
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Map,
    Symbol,
};

const FEE_TIER_005: u32 = 500;
const FEE_TIER_03: u32 = 3_000;
const FEE_TIER_1: u32 = 10_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FactoryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidFeeTier = 3,
    IdenticalTokens = 4,
    DuplicatePool = 5,
    PoolWasmHashMissing = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct PoolKey {
    pub token_a: Address,
    pub token_b: Address,
    pub fee_tier: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Initialized,
    Owner,
    MathLib,
    PoolWasmHash,
    Pools,
}

#[contracttype]
#[derive(Clone)]
pub struct PoolCreatedEvent {
    pub token_a: Address,
    pub token_b: Address,
    pub fee_tier: u32,
    pub pool: Address,
}

#[contract]
pub struct PoolFactory;

#[contractimpl]
impl PoolFactory {
    /// Returns the contract name for post-deploy verification.
    pub fn name(env: Env) -> Symbol {
        Symbol::new(&env, "pool_factory")
    }

    /// Initializes factory owner and external configuration.
    pub fn initialize(env: Env, owner: Address, math_lib: Address, pool_wasm_hash: BytesN<32>) {
        owner.require_auth();

        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Initialized)
            .unwrap_or(false)
        {
            panic_with_error!(&env, FactoryError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::MathLib, &math_lib);
        env.storage()
            .instance()
            .set(&DataKey::PoolWasmHash, &pool_wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::Pools, &Map::<PoolKey, Address>::new(&env));
    }

    /// Deploys a new CL pool contract for the token pair and fee tier.
    pub fn create_pool(env: Env, token_a: Address, token_b: Address, fee_tier: u32) -> Address {
        ensure_initialized(&env);
        validate_fee_tier(&env, fee_tier);

        let (token0, token1) = normalize_pair(&env, token_a, token_b);
        let key = PoolKey {
            token_a: token0.clone(),
            token_b: token1.clone(),
            fee_tier,
        };

        let mut pools = read_pools(&env);
        if pools.contains_key(key.clone()) {
            panic_with_error!(&env, FactoryError::DuplicatePool);
        }

        let wasm_hash = env
            .storage()
            .instance()
            .get::<DataKey, BytesN<32>>(&DataKey::PoolWasmHash)
            .unwrap_or_else(|| panic_with_error!(&env, FactoryError::PoolWasmHashMissing));

        let salt = env.crypto().sha256(&key.to_xdr(&env));
        let pool = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        pools.set(key.clone(), pool.clone());
        env.storage().instance().set(&DataKey::Pools, &pools);

        let event = PoolCreatedEvent {
            token_a: key.token_a,
            token_b: key.token_b,
            fee_tier,
            pool: pool.clone(),
        };
        env.events()
            .publish((Symbol::new(&env, "PoolCreated"),), event);

        pool
    }

    /// Returns the pool for a pair/fee tier if it exists.
    pub fn get_pool(env: Env, token_a: Address, token_b: Address, fee_tier: u32) -> Option<Address> {
        ensure_initialized(&env);
        let (token0, token1) = normalize_pair(&env, token_a, token_b);

        let key = PoolKey {
            token_a: token0,
            token_b: token1,
            fee_tier,
        };

        read_pools(&env).get(key)
    }

    /// Returns all deployed pools keyed by normalized (token_a, token_b, fee_tier).
    pub fn get_pools(env: Env) -> Map<PoolKey, Address> {
        ensure_initialized(&env);
        read_pools(&env)
    }

    pub fn get_owner(env: Env) -> Address {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn get_math_lib(env: Env) -> Address {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::MathLib).unwrap()
    }

    pub fn get_pool_wasm_hash(env: Env) -> BytesN<32> {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::PoolWasmHash).unwrap()
    }

    pub fn get_supported_fee_tiers(env: Env) -> soroban_sdk::Vec<u32> {
        let mut tiers = soroban_sdk::Vec::new(&env);
        tiers.push_back(FEE_TIER_005);
        tiers.push_back(FEE_TIER_03);
        tiers.push_back(FEE_TIER_1);
        tiers
    }

    /// Owner-only update for pool deployment WASM hash.
    pub fn set_pool_wasm_hash(env: Env, wasm_hash: BytesN<32>) {
        ensure_initialized(&env);
        require_owner(&env);
        env.storage().instance().set(&DataKey::PoolWasmHash, &wasm_hash);
    }

    /// Owner-only update for math library reference.
    pub fn set_math_lib(env: Env, math_lib: Address) {
        ensure_initialized(&env);
        require_owner(&env);
        env.storage().instance().set(&DataKey::MathLib, &math_lib);
    }

    /// Owner-only transfer of factory ownership.
    pub fn set_owner(env: Env, new_owner: Address) {
        ensure_initialized(&env);
        require_owner(&env);
        env.storage().instance().set(&DataKey::Owner, &new_owner);
    }
}

fn ensure_initialized(env: &Env) {
    if !env
        .storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
    {
        panic_with_error!(env, FactoryError::NotInitialized);
    }
}

fn require_owner(env: &Env) {
    let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
    owner.require_auth();
}

fn validate_fee_tier(env: &Env, fee_tier: u32) {
    if fee_tier != FEE_TIER_005 && fee_tier != FEE_TIER_03 && fee_tier != FEE_TIER_1 {
        panic_with_error!(env, FactoryError::InvalidFeeTier);
    }
}

fn normalize_pair(env: &Env, token_a: Address, token_b: Address) -> (Address, Address) {
    if token_a == token_b {
        panic_with_error!(env, FactoryError::IdenticalTokens);
    }

    let a = token_a.clone().into_val(env);
    let b = token_b.clone().into_val(env);
    if a < b {
        (token_a, token_b)
    } else {
        (token_b, token_a)
    }
}

fn read_pools(env: &Env) -> Map<PoolKey, Address> {
    env.storage()
        .instance()
        .get::<DataKey, Map<PoolKey, Address>>(&DataKey::Pools)
        .unwrap_or(Map::new(env))
}
