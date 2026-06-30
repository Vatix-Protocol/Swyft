# Changelog

All notable changes to `@swyft/sdk` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - Unreleased

### Added
- Initial public release of `@swyft/sdk`.
- `buildSwapTx` — build unsigned single-hop Soroban swap transactions.
- `calculateSwapQuote` — off-chain constant-product swap estimation.
- `buildBurnTx` / `buildCollectTx` — unsigned liquidity-management transactions.
- `estimateRemoveAmounts` / `estimateRemoveAmountsAsync` — token amount estimation for liquidity removal.
- `getPool` / `getPosition` / `getPositionWithLoading` / `getTick` — Soroban RPC pool and position query helpers.
- Dual CJS/ESM build via `tsup` with TypeScript declaration files.
- Published to npm registry as `@swyft/sdk` (public, scoped package).
- Automated publish workflow (`.github/workflows/publish-sdk.yml`) triggered on `sdk/v*` tags.
