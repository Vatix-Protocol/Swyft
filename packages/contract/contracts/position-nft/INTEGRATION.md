# Position NFT Integration Guide

This document provides step-by-step instructions for integrating the Position NFT contract with the Pool contract.

## Overview

The Position NFT contract is a separate contract that the Pool contract calls to mint and burn position NFTs. This separation allows for:
- Clean separation of concerns
- Independent upgrades of NFT and pool logic
- Potential for multiple pools to share the same NFT contract
- Better testability

## Integration Steps

### 1. Update Pool Contract Cargo.toml

Add the position-nft contract as a dependency (or as a path dependency during development):

```toml
[dev-dependencies]
position-nft = { path = "../position-nft" }
```

### 2. Update Pool Contract Initialization

The Pool contract needs to be initialized with the position NFT contract address:

```rust
// In pool/src/lib.rs

#[contracttype]
#[derive(Clone)]
pub struct PoolState {
    pub sqrt_price_x96: u128,
    pub tick: i32,
    pub liquidity: u128,
    pub fee_growth_global_0_x128: u128,
    pub fee_growth_global_1_x128: u128,
    pub fee_tier: u32,
    pub tick_spacing: i32,
    pub token_0: Address,
    pub token_1: Address,
    pub position_nft: Address,  // ADD THIS
}

// In the initialize function:
pub fn initialize(
    env: Env,
    token_0: Address,
    token_1: Address,
    position_nft: Address,  // ADD THIS PARAMETER
    sqrt_price_x96: u128,
    fee_tier: u32,
) {
    // ... validation ...
    let state = PoolState {
        // ... other fields ...
        position_nft,  // ADD THIS
    };
    env.storage().instance().set(&KEY_STATE, &state);
}
```

### 3. Update Pool Mint Function

Update the `mint` function to call the position NFT contract:

```rust
pub fn mint(
    env: Env,
    recipient: Address,
    tick_lower: i32,
    tick_upper: i32,
    amount: u128,
) -> Result<MintResult, PoolError> {
    recipient.require_auth();
    if amount == 0 {
        panic_with_pool_error(&env, PoolError::ZeroLiquidity);
    }
    
    let mut state = load_state(&env);
    validate_tick(&env, tick_lower, state.tick_spacing);
    validate_tick(&env, tick_upper, state.tick_spacing);
    if tick_lower >= tick_upper {
        panic_with_pool_error(&env, PoolError::InvalidTickRange);
    }

    // ... existing liquidity calculation logic ...

    // AFTER calculating amounts, mint the position NFT
    let position_nft_client = PositionNftClient::new(&env, &state.position_nft);
    let token_id = position_nft_client.mint(
        &recipient,
        &env.current_contract_address(),
        &tick_lower,
        &tick_upper,
        &amount,
    ).map_err(|_| PoolError::NftMintFailed)?;  // Add to error enum

    env.storage().instance().set(&KEY_STATE, &state);
    env.events().publish(
        (symbol_short!("mint"),),
        (recipient, tick_lower, tick_upper, amount, amount_0, amount_1, token_id),
    );

    Ok(MintResult { 
        amount_0, 
        amount_1,
        token_id,  // Return the position NFT ID
    })
}

// Update MintResult to include token_id:
#[contracttype]
#[derive(Clone)]
pub struct MintResult {
    pub amount_0: u128,
    pub amount_1: u128,
    pub token_id: u64,  // ADD THIS
}
```

### 4. Update Pool Burn Function

Update the `burn` function to call the position NFT contract:

```rust
pub fn burn(
    env: Env,
    owner: Address,
    token_id: u64,        // ADD THIS - requires position NFT ID instead of tick range
    tick_lower: i32,
    tick_upper: i32,
) -> Result<BurnResult, PoolError> {
    owner.require_auth();

    // Load and validate position from NFT contract
    let state = load_state(&env);
    let position_nft_client = PositionNftClient::new(&env, &state.position_nft);
    
    let position = position_nft_client.get_position(&token_id)
        .map_err(|_| PoolError::PositionNotFound)?;
    
    // Verify the position matches the provided tick range
    if position.tick_lower != tick_lower || position.tick_upper != tick_upper {
        panic_with_pool_error(&env, PoolError::InvalidTickRange);
    }

    // ... existing burn logic for updating ticks and liquidity ...

    // Burn the position NFT (after successful amount calculations)
    position_nft_client.burn(&token_id)
        .map_err(|_| PoolError::NftBurnFailed)?;  // Add to error enum

    env.storage().instance().set(&KEY_STATE, &state);
    env.events().publish(
        (symbol_short!("burn"),),
        (owner, tick_lower, tick_upper, liquidity, amount_0, amount_1, token_id),
    );

    Ok(BurnResult { amount_0, amount_1 })
}
```

### 5. Add Error Variants

Add new error variants to `PoolError`:

```rust
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum PoolError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidTick = 3,
    InvalidTickRange = 4,
    ZeroLiquidity = 5,
    Overflow = 6,
    InsufficientLiquidity = 7,
    InvalidTickSpacing = 8,
    NftMintFailed = 9,           // ADD THIS
    NftBurnFailed = 10,          // ADD THIS
    PositionNotFound = 11,       // ADD THIS
}
```

### 6. Update Collect Fees Function

If there's a `collect` or similar function to collect fees from a position:

```rust
pub fn collect_fees(
    env: Env,
    owner: Address,
    token_id: u64,
) -> CollectResult {
    owner.require_auth();
    
    let state = load_state(&env);
    let position_nft_client = PositionNftClient::new(&env, &state.position_nft);
    
    // Verify ownership
    let position = position_nft_client.get_position(&token_id)
        .ok_or(PoolError::PositionNotFound)?;
    
    if position.owner != owner {
        panic_with_pool_error(&env, PoolError::NotAuthorized);
    }

    // ... collect fees logic using position metadata ...
}
```

## Testing Integration

Update pool tests to include position NFT minting/burning:

```rust
#[test]
fn test_mint_and_burn_with_nft() {
    let env = Env::default();
    env.mock_all_auths();
    
    let pool_id = env.register(Pool, ());
    let nft_id = env.register(PositionNft, ());
    
    let pool_client = PoolClient::new(&env, &pool_id);
    let nft_client = PositionNftClient::new(&env, &nft_id);
    
    let token_0 = Address::generate(&env);
    let token_1 = Address::generate(&env);
    let lp = Address::generate(&env);
    
    // Initialize NFT first
    nft_client.initialize(&pool_id);
    
    // Initialize pool with NFT address
    pool_client.initialize(&token_0, &token_1, &nft_id, &Q96, &3000u32);
    
    // Mint position
    let result = pool_client.mint(&lp, &-100i32, &100i32, &1000u128);
    let token_id = result.token_id;
    
    // Verify NFT was created
    let position = nft_client.get_position(&token_id).unwrap();
    assert_eq!(position.owner, lp);
    assert_eq!(position.tick_lower, -100i32);
    assert_eq!(position.tick_upper, 100i32);
    
    // Burn position
    pool_client.burn(&lp, &token_id, &-100i32, &100i32);
    
    // Verify NFT was destroyed
    assert!(nft_client.get_position(&token_id).is_err());
}
```

## Pool Factory Integration

If using a Pool Factory to deploy pools:

```rust
pub fn create_pool(
    env: Env,
    token_0: Address,
    token_1: Address,
    position_nft: Address,  // ADD THIS
    fee_tier: u32,
) -> Address {
    let pool_id = env.register_contract(None, Pool);
    let pool_client = PoolClient::new(&env, &pool_id);
    
    pool_client.initialize(
        &token_0,
        &token_1,
        &position_nft,  // Pass to pool
        &default_price(),
        &fee_tier,
    );
    
    // Track the pool...
    pool_id
}
```

## Summary of Changes

| File | Changes |
|------|---------|
| `Pool Cargo.toml` | Add position-nft dependency |
| `Pool PoolState` | Add `position_nft: Address` field |
| `Pool initialize()` | Add `position_nft` parameter |
| `Pool mint()` | Call NFT mint, return token_id |
| `Pool burn()` | Accept token_id, call NFT burn |
| `Pool MintResult` | Add `token_id` field |
| `Pool BurnResult` | Keep as-is or add token_id |
| `Pool PoolError` | Add NftMintFailed, NftBurnFailed, PositionNotFound |
| Pool tests | Add integration tests with NFT |

## Deployment

1. Deploy the Position NFT contract
2. Deploy the Pool contract with the position NFT address
3. Pool Factory creates pools with the shared NFT contract address

## Verification Checklist

- [ ] NFTs are created when liquidity is added
- [ ] NFTs are destroyed when liquidity is fully removed
- [ ] Position owners can transfer their NFTs
- [ ] Transfer events are emitted correctly
- [ ] Position metadata is stored and retrievable
- [ ] Only pool contract can mint/burn positions
- [ ] Frontend can query position metadata via SDK
- [ ] Tests pass for all integration scenarios
