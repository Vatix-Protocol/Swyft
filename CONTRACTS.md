# Swyft Smart Contracts

All 9 Swyft smart contracts compile and build successfully.

## Contracts

| Contract         | Purpose                     | Status |
| ---------------- | --------------------------- | ------ |
| `hello-world`    | Example contract            | ✅     |
| `math-lib`       | Fixed-point math (Q64.96)   | ✅     |
| `pool`           | Concentrated liquidity pool | ✅     |
| `pool-factory`   | Pool deployment & registry  | ✅     |
| `router`         | Single-hop swap routing     | ✅     |
| `position-nft`   | Liquidity position NFTs     | ✅     |
| `fee-collector`  | Fee accumulation            | ✅     |
| `oracle-adapter` | TWAP oracle                 | ✅     |
| `cl-pool`        | Additional pool logic       | ✅     |

## Testnet registry

Deployed testnet contract IDs live in:

- **JSON registry**: [`packages/contract/deployments/testnet.json`](packages/contract/deployments/testnet.json)
- **Key map / docs**: [`packages/contract/deployments/TESTNET.md`](packages/contract/deployments/TESTNET.md)

Wire addresses into the API via the env keys listed in that registry (see `apps/api/.env.example`).

## Validation

Run the contract validation CLI:

```bash
pnpm validate:contracts
```

Output:

```
Building hello-world... ✓
Building math-lib... ✓
Building pool... ✓
...
Passed: 9/9
All Swyft contracts validated!
```

### Address drift (CI gate)

`scripts/deploy-testnet.sh` records a sha256 hash of each deployed contract's
wasm under `.wasmHashes` in `packages/contract/deployments/testnet.json`,
alongside its address. `pnpm validate:contracts:drift` rebuilds every
contract and compares the fresh wasm hash against the recorded one for any
contract that has a deployed address — if they don't match, the contract's
source has changed since it was deployed (drifted) and the command exits
non-zero.

This runs as the `Contracts` job in CI (`.github/workflows/ci.yml`) on every
push/PR — a contract build failure or address drift fails the job. The
comparison logic itself (`packages/contract/scripts/check-address-drift.js`)
is unit-tested against a fixture with an intentional mismatch:

```bash
pnpm --filter contracts test:drift
```

If a contract's address genuinely drifts (source changed post-deploy),
redeploy with `pnpm --filter contracts deploy:testnet` and commit the
updated `testnet.json`.

## Build Details

- **Language**: Rust
- **Platform**: Stellar Soroban
- **Target**: `wasm32-unknown-unknown`
- **Build Tool**: Cargo + Stellar CLI
- **Workspace**: `packages/contract/Cargo.toml`

## Key Fixes Applied

- Fixed missing `cl-pool/Cargo.toml` and workspace configuration
- Resolved cross-contract linking conflicts (cl-pool → position-nft)
- Fixed type compatibility (i16 → i32 for Soroban)
- Implemented proper error handling with `#[contracterror]`
- Replaced unsafe panic macros with error functions
- Fixed arithmetic overflow and panic safety issues

## Next Steps

- [ ] Add comprehensive contract tests
- [ ] Integrate with Stellar testnet
- [ ] Security audit preparation
- [ ] Documentation for contract interfaces
