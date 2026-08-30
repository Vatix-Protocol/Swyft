# Swyft Contracts

Soroban smart contracts for the Swyft concentrated-liquidity DEX on Stellar.

## Contract overview

| Contract         | Crate            | Purpose                                            |
| ---------------- | ---------------- | -------------------------------------------------- |
| `math-lib`       | `math_lib`       | Fixed-point math utilities (sqrt, liquidity delta) |
| `pool-factory`   | `pool_factory`   | Deploys and tracks CL pool instances               |
| `router`         | `router`         | Routes swaps across pools                          |
| `position-nft`   | `position_nft`   | Mints/tracks LP position NFTs                      |
| `cl-pool`        | `cl_pool`        | Concentrated-liquidity pool (tick-based swaps)     |
| `fee-collector`  | `fee_collector`  | Aggregates and distributes protocol fees           |
| `oracle-adapter` | `oracle_adapter` | Wraps an upstream price oracle                     |

## Router ↔ CL-Pool swap protocol

The `router` executes single-hop exact-input swaps by calling the `cl-pool`
contract directly. Integrators building on the router should be aware of the
interface contract:

- Direction is derived on-chain from the pool's token ordering, exposed via
  `cl-pool` getters `get_token_0` / `get_token_1`. `zero_for_one` is true when
  `token_in == token_0`.
- `cl-pool.swap` is an **exact-input-only** swap with signature
  `swap(sender, zero_for_one, amount_in, sqrt_price_limit_x96) -> (i128, i128)`
  returning signed token deltas, *not* a `SwapResult` struct. The router maps
  those `(i128, i128)` deltas into `SwapResult { amount_in, amount_out }`.
- The party funding the swap is also the recipient of the output: `cl-pool.swap`
  moves both token legs to/from a single `sender`. The router therefore uses its
  `recipient` argument as the pool's `sender`.
- Because `cl-pool.swap` is exact-input only, the router's `exact_output_single`
  reverts with `RouterError::ExactOutputUnsupported` rather than silently
  executing an unrelated swap. Exact-output routing requires pool-side exact-
  output support (not yet present in `cl-pool` v1).

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
    "mathLib": "C...",
    "poolFactory": "C...",
    "router": "C...",
    "positionNft": "C...",
    "feeCollector": "C...",
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
