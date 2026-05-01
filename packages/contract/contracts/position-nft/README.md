# Position NFT Contract

This contract implements a position NFT system for Swyft, allowing LP positions to be tokenized as non-fungible tokens on Stellar.

## Overview

The Position NFT contract mints non-fungible tokens that represent ownership of liquidity positions in Swyft pools. Each NFT holds metadata about the position (pool address, tick range, liquidity amount, etc.) and can be transferred between addresses.

## Key Features

- **Minting**: Creates a new position NFT when an LP adds liquidity
- **Burning**: Destroys a position NFT when a position is fully closed
- **Transfer**: Allows position NFT owners to transfer their positions to other addresses
- **Ownership**: Tracks the current owner of each position
- **Events**: Emits Transfer events for all state changes
- **Metadata**: Stores complete position information including creation timestamp

## Contract Interface

### Types

```rust
pub struct PositionMetadata {
    pub owner: Address,           // Current owner of the position
    pub pool: Address,            // Pool address where the position exists
    pub tick_lower: i32,          // Lower tick of the position range
    pub tick_upper: i32,          // Upper tick of the position range
    pub liquidity: u128,          // Liquidity amount in the position
    pub created_at: u64,          // Unix timestamp of creation
}

pub enum PositionNftError {
    NotAuthorized = 1,            // Caller is not authorized
    PositionNotFound = 2,         // Position token ID does not exist
    NotInitialized = 3,           // Contract not yet initialized
    Overflow = 4,                 // Arithmetic overflow (max IDs reached)
}
```

### Functions

#### `initialize(minter: Address) -> Result<(), PositionNftError>`

Initializes the contract with a minter address (typically the pool factory contract).

**Authorization**: Requires `minter` to authorize the call

**Effects**:
- Sets the minter address
- Initializes the next token ID counter to 0
- Can only be called once

**Returns**: `Ok(())` on success, or `PositionNftError` on failure

---

#### `mint(owner: Address, pool: Address, tick_lower: i32, tick_upper: i32, liquidity: u128) -> Result<u64, PositionNftError>`

Mints a new position NFT.

**Authorization**: Only the minter address can call this function

**Parameters**:
- `owner`: The address that will own the position NFT
- `pool`: The pool address where this position exists
- `tick_lower`: Lower tick of the position range
- `tick_upper`: Upper tick of the position range
- `liquidity`: The liquidity amount of the position

**Effects**:
- Creates a new position with metadata
- Assigns a unique, auto-incrementing token ID
- Records the creation timestamp
- Increments the total supply counter
- Emits a Transfer event: `Transfer(0x0, owner, token_id)`

**Returns**: The newly created token ID on success, or `PositionNftError` on failure

---

#### `burn(token_id: u64) -> Result<(), PositionNftError>`

Destroys a position NFT when the position is fully closed.

**Authorization**: Only the minter address can call this function

**Parameters**:
- `token_id`: The ID of the position NFT to burn

**Effects**:
- Removes the position from storage
- Emits a Transfer event: `Transfer(owner, 0x0, token_id)`

**Returns**: `Ok(())` on success, or `PositionNftError` on failure

---

#### `transfer(token_id: u64, from: Address, to: Address) -> Result<(), PositionNftError>`

Transfers a position NFT from one address to another.

**Authorization**: Requires `from` to authorize the call

**Parameters**:
- `token_id`: The ID of the position NFT to transfer
- `from`: The current owner of the position
- `to`: The new owner of the position

**Effects**:
- Updates the owner field in the position metadata
- Preserves all other metadata (pool, ticks, liquidity, timestamp)
- Emits a Transfer event: `Transfer(from, to, token_id)`

**Returns**: `Ok(())` on success, or `PositionNftError` on failure

---

#### `owner_of(token_id: u64) -> Result<Address, PositionNftError>`

Returns the current owner of a position NFT.

**Authorization**: None required

**Parameters**:
- `token_id`: The ID of the position NFT

**Returns**: The owner address on success, or `PositionNftError::PositionNotFound` if the token doesn't exist

---

#### `get_position(token_id: u64) -> Result<PositionMetadata, PositionNftError>`

Returns the complete metadata of a position NFT.

**Authorization**: None required

**Parameters**:
- `token_id`: The ID of the position NFT

**Returns**: The complete `PositionMetadata` on success, or `PositionNftError::PositionNotFound` if the token doesn't exist

**Used by**: Frontend portfolio views, SDK queries

---

#### `total_supply() -> u64`

Returns the total number of positions ever minted (next ID to be issued).

**Authorization**: None required

**Returns**: The next token ID to be assigned

**Note**: This represents the upper bound of existing positions (IDs 0 to `total_supply - 1`), but some may have been burned.

---

### Events

The contract emits `Transfer` events with the following structure:

```
Event: (topic1: "transfer", topic2: "nft")
Data: (from: Address, to: Address, token_id: u64)
```

- **Mint**: `Transfer(0x0, owner, token_id)`
- **Transfer**: `Transfer(from, to, token_id)`
- **Burn**: `Transfer(owner, 0x0, token_id)`

## Integration with Pool Contract

The Pool contract should integrate with the Position NFT contract as follows:

### On Add Liquidity (Mint Position)

```rust
// In Pool::mint()
let position_nft_client = PositionNftClient::new(&env, &position_nft_address);
let token_id = position_nft_client.mint(
    &recipient,
    &contract_id,  // self (pool address)
    &tick_lower,
    &tick_upper,
    &amount,
)?;
// Return token_id along with amount_0 and amount_1
```

### On Remove Liquidity (Burn Position)

```rust
// In Pool::burn()
let position_nft_client = PositionNftClient::new(&env, &position_nft_address);
position_nft_client.burn(&token_id)?;
```

## Storage Layout

The contract uses the following storage keys:

- **Instance Storage**:
  - `"MINTER"`: The authorized minter address
  - `"NEXT_ID"`: The next token ID to be assigned (u64)

- **Persistent Storage**:
  - `["POS", <token_id_string>]`: The `PositionMetadata` for each position

## Building the Contract

```bash
# Build all contracts
cd packages/contract
stellar contract build

# Build only position-nft
stellar contract build --manifest-path contracts/position-nft/Cargo.toml

# Run tests
cargo test --manifest-path contracts/position-nft/Cargo.toml
```

## Testing

The contract includes comprehensive test coverage:

- Initialization tests
- Mint functionality and auto-incrementing IDs
- Transfer functionality and ownership changes
- Burn functionality and removal
- Error handling and edge cases
- Event emission validation
- Permission enforcement

Run tests with:
```bash
cargo test --manifest-path contracts/position-nft/Cargo.toml
```

## SDK Integration

The SDK can query positions using:

```typescript
// Get position metadata
const position = await sdk.getPosition(tokenId);
console.log(position.lowerTick, position.upperTick, position.liquidity);

// Get position owner
const owner = await sdk.getOwner(tokenId);

// Subscribe to transfer events
sdk.on('transfer', (event) => {
  console.log(`Position ${event.tokenId} transferred from ${event.from} to ${event.to}`);
});
```

## Error Handling

- `NotAuthorized`: Caller lacks required authorization (not minter for mint/burn, not owner for transfer)
- `PositionNotFound`: The specified token ID does not exist
- `NotInitialized`: Contract has not been initialized yet
- `Overflow`: Token ID counter overflow (extremely unlikely in practice)
