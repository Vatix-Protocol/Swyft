# Changelog

All notable changes to `@swyft/sdk` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - Unreleased

### Added
- Per-module subpath exports (`@swyft/sdk/quote`, `/liquidity`, `/queries`, `/swap`, `/types`, `/config`) alongside the root `@swyft/sdk` barrel, so bundlers only pull in the code that's actually imported.
- Explicit `browser` / `import` / `require` conditions on every entrypoint so browser bundlers and Node (ESM and CJS) resolve the correct build without extra configuration.
- Initial public release of `@swyft/sdk`.
- `buildSwapTx` — build unsigned single-hop Soroban swap transactions.
- `calculateSwapQuote` — off-chain constant-product swap estimation.
- `buildBurnTx` / `buildCollectTx` — unsigned liquidity-management transactions.
- `estimateRemoveAmounts` / `estimateRemoveAmountsAsync` — token amount estimation for liquidity removal.
- `getPool` / `getPosition` / `getPositionWithLoading` / `getTick` — Soroban RPC pool and position query helpers.
- Dual CJS/ESM build via `tsup` with TypeScript declaration files.
- Published to npm registry as `@swyft/sdk` (public, scoped package).
- Automated publish workflow (`.github/workflows/publish-sdk.yml`) triggered on `sdk/v*` tags.

### Fixed
- `package.json`'s `module`/`types`/`exports` fields pointed at `.js`/`.d.ts` file names, but the ESM and declaration builds actually emit `.mjs`/`.d.mts` (tsup's default extensions for a package without `"type": "module"`). This silently broke `import`/`types` resolution for any consumer that resolved the built `dist/` output rather than the workspace source. Paths now match the real build output.
