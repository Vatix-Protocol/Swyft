# Swyft Contracts

Soroban smart contracts for the Swyft concentrated-liquidity DEX on Stellar.

## Contract overview

| Contract | Crate | Purpose |
|---|---|---|
| `math-lib` | `math_lib` | Fixed-point math utilities (sqrt, liquidity delta) |
| `pool-factory` | `pool_factory` | Deploys and tracks CL pool instances |
| `router` | `router` | Routes swaps across pools |
| `position-nft` | `position_nft` | Mints/tracks LP position NFTs |
| `fee-collector` | `fee_collector` | Aggregates and distributes protocol fees |
| `oracle-adapter` | `oracle_adapter` | Wraps an upstream price oracle |

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
4. Deploys in dependency order: `math-lib` → `pool-factory` → `router` → `position-nft` → `fee-collector` → `oracle-adapter`
5. Verifies each contract by invoking its `name()` read function
6. Writes all addresses to `deployments/testnet.json`

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
    "mathLib":       "C...",
    "poolFactory":   "C...",
    "router":        "C...",
    "positionNft":   "C...",
    "feeCollector":  "C...",
    "oracleAdapter": "C..."
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
