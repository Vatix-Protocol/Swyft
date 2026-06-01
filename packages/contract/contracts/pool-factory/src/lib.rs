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
    LoadingInProgress = 7,
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
    Loading,
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
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    /// - `owner`: Account that becomes the factory owner.
    /// - `math_lib`: Address of the deployed math library contract.
    /// - `pool_wasm_hash`: WASM hash for pool deployment.
    ///
    /// # Returns
    /// Nothing.
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
        env.storage().instance().set(&DataKey::Loading, &false);
    }

    /// Deploys a new CL pool contract for the token pair and fee tier.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    /// - `token_a`: Address of the first token in the pair.
    /// - `token_b`: Address of the second token in the pair.
    /// - `fee_tier`: Fee tier for the pool deployment.
    ///
    /// # Returns
    /// The address of the newly deployed pool contract.
    pub fn create_pool(env: Env, token_a: Address, token_b: Address, fee_tier: u32) -> Address {
        ensure_initialized(&env);
        ensure_not_loading(&env);
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

        set_loading(&env, true);
        let salt = env.crypto().sha256(&key.to_xdr(&env));
        let pool = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        pools.set(key.clone(), pool.clone());
        env.storage().instance().set(&DataKey::Pools, &pools);
        set_loading(&env, false);

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
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    /// - `token_a`: Address of the first token in the pair.
    /// - `token_b`: Address of the second token in the pair.
    /// - `fee_tier`: Fee tier of the pool.
    ///
    /// # Returns
    /// An optional pool `Address`, or `None` if no matching pool exists.
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
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    ///
    /// # Returns
    /// A map of all deployed pools keyed by normalized token pairs and fee tier.
    pub fn get_pools(env: Env) -> Map<PoolKey, Address> {
        ensure_initialized(&env);
        read_pools(&env)
    }

    /// Returns the current factory owner.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    ///
    /// # Returns
    /// The `Address` of the current factory owner.
    pub fn get_owner(env: Env) -> Address {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    /// Returns the math library address used by the factory.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    ///
    /// # Returns
    /// The `Address` of the configured math library contract.
    pub fn get_math_lib(env: Env) -> Address {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::MathLib).unwrap()
    }

    /// Returns the current WASM hash used for pool deployments.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    ///
    /// # Returns
    /// The 32-byte WASM hash for deploying new pools.
    pub fn get_pool_wasm_hash(env: Env) -> BytesN<32> {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::PoolWasmHash).unwrap()
    }

    /// Returns whether the factory is currently processing a long-running write.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    ///
    /// # Returns
    /// `true` when the factory is in a loading state, otherwise `false`.
    pub fn get_is_loading(env: Env) -> bool {
        ensure_initialized(&env);
        is_loading(&env)
    }

    /// Returns the supported fee tiers for pools deployed by this factory.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    ///
    /// # Returns
    /// A vector of supported fee tier values.
    pub fn get_supported_fee_tiers(env: Env) -> soroban_sdk::Vec<u32> {
        let mut tiers = soroban_sdk::Vec::new(&env);
        tiers.push_back(FEE_TIER_005);
        tiers.push_back(FEE_TIER_03);
        tiers.push_back(FEE_TIER_1);
        tiers
    }

    /// Owner-only update for pool deployment WASM hash.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    /// - `wasm_hash`: New 32-byte WASM hash for pool deployment.
    ///
    /// # Returns
    /// Nothing.
    pub fn set_pool_wasm_hash(env: Env, wasm_hash: BytesN<32>) {
        ensure_initialized(&env);
        ensure_not_loading(&env);
        require_owner(&env);
        env.storage().instance().set(&DataKey::PoolWasmHash, &wasm_hash);
    }

    /// Owner-only update for math library reference.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    /// - `math_lib`: New math library contract address.
    ///
    /// # Returns
    /// Nothing.
    pub fn set_math_lib(env: Env, math_lib: Address) {
        ensure_initialized(&env);
        ensure_not_loading(&env);
        require_owner(&env);
        env.storage().instance().set(&DataKey::MathLib, &math_lib);
    }

    /// Owner-only transfer of factory ownership.
    ///
    /// # Parameters
    /// - `env`: Soroban environment handle.
    /// - `new_owner`: Address of the new owner account.
    ///
    /// # Returns
    /// Nothing.
    pub fn set_owner(env: Env, new_owner: Address) {
        ensure_initialized(&env);
        ensure_not_loading(&env);
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

fn is_loading(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Loading)
        .unwrap_or(false)
}

fn ensure_not_loading(env: &Env) {
    if is_loading(env) {
        panic_with_error!(env, FactoryError::LoadingInProgress);
    }
}

fn set_loading(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::Loading, &value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let factory_id = env.register_contract(None, PoolFactory);
        (env, factory_id)
    }

    #[test]
    fn test_initialize_and_get_owner() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        assert_eq!(client.get_owner(), owner);
        assert_eq!(client.get_math_lib(), math_lib);
        assert_eq!(client.get_pool_wasm_hash(), pool_wasm_hash);
    }

    #[test]
    #[should_panic(expected = "FactoryError(AlreadyInitialized)")]
    fn test_initialize_already_initialized() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        // Try to initialize again
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
    }

    #[test]
    fn test_get_supported_fee_tiers() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let tiers = client.get_supported_fee_tiers();
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers.get(0), FEE_TIER_005);
        assert_eq!(tiers.get(1), FEE_TIER_03);
        assert_eq!(tiers.get(2), FEE_TIER_1);
    }

    #[test]
    #[should_panic(expected = "FactoryError(InvalidFeeTier)")]
    fn test_create_pool_invalid_fee_tier() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        let invalid_fee = 12345; // Invalid fee tier
        
        client.create_pool(&token_a, &token_b, &invalid_fee);
    }

    #[test]
    #[should_panic(expected = "FactoryError(IdenticalTokens)")]
    fn test_create_pool_identical_tokens() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let token = Address::generate(&env);
        client.create_pool(&token, &token, &FEE_TIER_03);
    }

    #[test]
    #[should_panic(expected = "FactoryError(NotInitialized)")]
    fn test_get_pool_not_initialized() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        
        client.get_pool(&token_a, &token_b, &FEE_TIER_03);
    }

    #[test]
    fn test_get_pool_nonexistent() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        
        let pool = client.get_pool(&token_a, &token_b, &FEE_TIER_03);
        assert!(pool.is_none());
    }

    #[test]
    fn test_get_is_loading_defaults_false() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);

        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);

        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        assert_eq!(client.get_is_loading(), false);
    }

    #[test]
    fn test_create_pool_clears_loading_state() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);

        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);

        client.initialize(&owner, &math_lib, &pool_wasm_hash);

        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);

        client.create_pool(&token_a, &token_b, &FEE_TIER_03);
        assert_eq!(client.get_is_loading(), false);
    }

    #[test]
    fn test_set_pool_wasm_hash_owner_only() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let new_wasm_hash = BytesN::<32>::from_array(&env, [2; 32]);
        client.set_pool_wasm_hash(&new_wasm_hash);
        
        assert_eq!(client.get_pool_wasm_hash(), new_wasm_hash);
    }

    #[test]
    fn test_set_math_lib_owner_only() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let new_math_lib = Address::generate(&env);
        client.set_math_lib(&new_math_lib);
        
        assert_eq!(client.get_math_lib(), new_math_lib);
    }

    #[test]
    fn test_set_owner() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let owner = Address::generate(&env);
        let math_lib = Address::generate(&env);
        let pool_wasm_hash = BytesN::<32>::from_array(&env, [1; 32]);
        
        client.initialize(&owner, &math_lib, &pool_wasm_hash);
        
        let new_owner = Address::generate(&env);
        client.set_owner(&new_owner);
        
        assert_eq!(client.get_owner(), new_owner);
    }

    #[test]
    fn test_name() {
        let (env, factory_id) = setup();
        let client = PoolFactoryClient::new(&env, &factory_id);
        
        let name = client.name();
        assert_eq!(name, Symbol::new(&env, "pool_factory"));
    }
}

