# @swyft/sdk

TypeScript SDK for Swyft — concentrated liquidity DEX on Stellar.

## Installation

```bash
pnpm add @swyft/sdk
```

## Quickstart

```ts
import { getPool, getPosition, getTick } from '@swyft/sdk';

const RPC = 'https://soroban-testnet.stellar.org';
const POOL = 'C...your_pool_contract_address...';

// Fetch pool state
const pool = await getPool({ rpcUrl: RPC, poolAddress: POOL });
console.log(pool.sqrtPrice, pool.currentTick, pool.liquidity);

// Compute a rough swap quote (amount out ≈ amountIn × price²)
const price = Number(pool.sqrtPrice) ** 2;
const amountIn = 100;
const estimatedOut = amountIn * price;
console.log(`~${estimatedOut} token1 for ${amountIn} token0`);

// Fetch a position
const position = await getPosition({ rpcUrl: RPC, positionNftId: 'C...nft_address...' });
console.log(position.lowerTick, position.upperTick, position.liquidity);

// Fetch a tick
const tick = await getTick({ rpcUrl: RPC, poolAddress: POOL, tick: pool.currentTick });
console.log(tick.liquidityNet, tick.feeGrowthOutside);
```

## API

### `getPool({ rpcUrl, poolAddress }): Promise<PoolState>`

Fetches current pool state from Soroban RPC.

| Field | Type | Description |
|---|---|---|
| `poolAddress` | `string` | Contract address queried |
| `sqrtPrice` | `string` | √P as a fixed-point string |
| `currentTick` | `number` | Active tick index |
| `liquidity` | `string` | Active liquidity |
| `feeTier` | `number` | Fee in hundredths of a bip (e.g. 3000 = 0.3%) |
| `token0` | `string` | Token 0 contract address |
| `token1` | `string` | Token 1 contract address |

### `getPosition({ rpcUrl, positionNftId }): Promise<PositionState>`

Fetches position state by NFT contract address.

### `getTick({ rpcUrl, poolAddress, tick }): Promise<TickState>`

Fetches tick-level state for a specific tick index.

## Error handling

All functions throw `SwyftRpcError` on RPC failure or unexpected response shape.

```ts
import { SwyftRpcError } from '@swyft/sdk';

try {
  const pool = await getPool({ rpcUrl, poolAddress });
} catch (err) {
  if (err instanceof SwyftRpcError) {
    console.error('RPC error:', err.message);
  }
}
```

## Notes

- `rpcUrl` is always passed as a parameter — the SDK never reads from environment variables.
- Works against both testnet (`https://soroban-testnet.stellar.org`) and mainnet RPC URLs.
