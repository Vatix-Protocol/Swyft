# Swyft Contracts

Soroban smart contracts for the Swyft concentrated-liquidity DEX on Stellar.

## Contract overview

| Contract         | Crate            | Purpose                                            |
| ---------------- | ---------------- | -------------------------------------------------- |
| `math-lib`       | `math_lib`       | Fixed-point math utilities (sqrt, liquidity delta) |
| `pool`           | `pool`           | Legacy/simplified pool (also records oracle TWAP)  |
| `cl-pool`        | `cl_pool`        | Concentrated-liquidity pool (records oracle TWAP)  |
| `pool-factory`   | `pool_factory`   | Deploys and tracks CL pool instances               |
| `router`         | `router`         | Routes swaps across pools                          |
| `position-nft`   | `position_nft`   | Mints/tracks LP position NFTs                      |
| `cl-pool`        | `cl_pool`        | Concentrated-liquidity pool (tick-based swaps)     |
| `fee-collector`  | `fee_collector`  | Aggregates and distributes protocol fees           |
| `oracle-adapter` | `oracle_adapter` | Circular-buffer TWAP oracle (per-pool instance)    |

## Oracle / TWAP

Every swap on `pool` and `cl-pool` records a post-swap observation
(`sqrt_price_x96`, active `liquidity`, ledger timestamp) with a configured
[`oracle-adapter`](contracts/oracle-adapter) instance. `get_twap(window_secs)`
answers time-weighted-average-price queries from that history — quotes,
indexers, and wallets read real on-chain price history instead of stale or
mock data.

- **One adapter per pool**: an adapter registers a single pool as the only
  address allowed to write observations, so each pool gets its own instance
  (`oracleAdapter` → `pool`, `clPoolOracleAdapter` → `cl-pool`).
- **Wiring**: `oracle.initialize(pool)` then `pool.set_oracle(oracle)`. Both are
  one-time calls; the deploy script wires them automatically.
- **Failure mode**: with no oracle wired, swaps still execute but `get_twap`
  fails loudly (`InsufficientHistory` / `WindowTooLarge`) rather than returning
  fabricated prices. Once wired, a failed observation write reverts the swap —
  the TWAP is never silently stale.

### Pool liquidity lifecycle

The `pool` contract moves real tokens on every liquidity change:

-  `pool.mint(sender, position_id, tick_lower, tick_upper, amount)` requires auth from
  `sender` and transfers the quoted `amount_0`/`amount_1` **from the sender into the
  pool contract** before recording the position. `sender` must hold sufficient
  balances of both pool tokens.
-  `pool.burn(sender, position_id, tick_lower, tick_upper, amount)` requires auth from
  `sender` and transfers the redeemed `amount_0`/`amount_1` **from the pool contract
  back to `sender`**.

The returned amounts are the exact token deltas, so integrators (SDK, indexer, LP UI)
can rely on wallet/contract balances moving in lockstep with quotes — the contract does
not silently report liquidity it never funded.

## Prerequisites

- Rust stable + `wasm32-unknown-unknown` target
- [`stellar-cli`](https://developers.stellar.org/docs/smart-contracts/getting-started/setup)
- `jq`, `curl`

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```

## Build

```bash
stellar contract build
# or via pnpm from the repo root:
pnpm --filter contracts build
```

## Test

```bash
cargo test --workspace
# or:
pnpm --filter contracts test
```

## Testnet deployment

The deployment script:

1. Generates (or reuses) a `swyft-deployer` stellar-cli identity
2. Funds the deployer via Friendbot if balance < 10 XLM
3. Builds all contracts
4. Deploys in dependency order: `math-lib` → `pool-factory` → `pool` → `cl-pool` → `router` → `position-nft` → `fee-collector` → `oracle-adapter` (×2)
5. Verifies each contract by invoking its `name()` read function
6. Wires each pool to its own oracle-adapter instance
7. Writes all addresses to `deployments/testnet.json`

### Run

```bash
pnpm --filter contracts deploy:testnet

# Force redeploy even if addresses already exist:
pnpm --filter contracts deploy:testnet:force
```

### Output — `deployments/testnet.json`

```json
{
  "network": "testnet",
  "deployer": "G...",
  "contracts": {
    "mathLib": "C...",
    "poolFactory": "C...",
    "router": "C...",
    "positionNft": "C...",
    "feeCollector": "C...",
    "oracleAdapter": "C...",
    "clPoolOracleAdapter": "C..."
  },
  "deployedAt": {
    "mathLib": "2025-01-01T00:00:00Z"
  }
}
```

This file is consumed by the backend indexer (`apps/api`) and the TypeScript SDK (`packages/sdk`).

### Idempotency

Re-running the script skips contracts that already have an address in `testnet.json`. Pass `--force` to override.

### CI — manual trigger

The workflow `.github/workflows/deploy-testnet.yml` exposes a `workflow_dispatch` trigger in GitHub Actions. Set the `TESTNET_DEPLOYER_SECRET_KEY` repository secret before running it.
