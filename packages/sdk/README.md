# @swyft/sdk

JavaScript / TypeScript SDK for the [Swyft](https://github.com/Vatix-Protocol/Swyft) concentrated-liquidity DEX on [Stellar Soroban](https://soroban.stellar.org).

---

## Installation

```bash
# npm
npm install @swyft/sdk @stellar/stellar-sdk

# pnpm
pnpm add @swyft/sdk @stellar/stellar-sdk

# yarn
yarn add @swyft/sdk @stellar/stellar-sdk
```

> `@stellar/stellar-sdk` is a **peer dependency**. Install it alongside `@swyft/sdk`.

---

## Quick Start

```ts
import {
  buildSwapTx,
  toStellarAddress,
  toRawAmount,
  calculateSwapQuote,
  getPool,
} from '@swyft/sdk';

// 1. Get a quick off-chain quote
const quote = calculateSwapQuote({
  poolId:      'CPOOL...address',
  tokenInId:   'CUSDC...address',
  tokenOutId:  'CXLM...address',
  amountIn:    '1000000', // 1 USDC (6 decimals)
  slippageBps: 50,        // 0.5 %
});

console.log(quote.amountOut, quote.minimumReceived);

// 2. Build an unsigned swap transaction
const tx = buildSwapTx({
  poolId:           toStellarAddress('CPOOL...address'),
  tokenInId:        toStellarAddress('CUSDC...address'),
  tokenOutId:       toStellarAddress('CXLM...address'),
  amountIn:         toRawAmount('1000000'),
  minimumReceived:  toRawAmount(quote.minimumReceived),
  ownerAddress:     toStellarAddress('GWALLET...address'),
});

// tx.xdr is a base-64 XDR string ready for wallet signing
console.log(tx.xdr);
```

---

## Network passphrase guards

Every SDK entrypoint that touches liquidity, trading, or settlement paths is
guarded by a **fail-closed network passphrase check**. Before any operation
runs, the SDK validates the configured network passphrase against the expected
network and rejects the call when the passphrase is missing, malformed, or does
not match the target network (testnet vs mainnet).

```ts
import { assertNetworkPassphrase, NetworkPassphraseError } from '@swyft/sdk/config';

try {
  assertNetworkPassphrase({
    networkPassphrase: 'Test SDF Network ; September 2015',
    expected: 'testnet',
  });
} catch (err) {
  if (err instanceof NetworkPassphraseError) {
    // err.code is a stable, documented error code
    console.error(err.code, err.message, err.correlationId);
  }
}
```

### Guarded entrypoints

The guard runs automatically on the money-path entrypoints:

| Entrypoint | Path |
|---|---|
| `buildSwapTx` | trading |
| `buildBurnTx` | liquidity |
| `buildCollectTx` | liquidity / settlement |
| `getSwapQuote` | trading |
| `getPool` / `getPosition` / `getTick` | queries |

Untrusted callers cannot bypass network policy: the guard is enforced inside
the SDK, not left to the caller, and it fails closed (deny-by-default) rather
than falling back to a default network.

### Stable error codes

`NetworkPassphraseError` carries a stable `code` plus structured metadata
(`correlationId`, `expected`, `received`) so callers and ops tooling can react
without parsing messages. No secrets are included in the error payload.

| Code | Meaning |
|---|---|
| `SWYFT_NETWORK_PASSPHRASE_MISSING` | No passphrase was configured |
| `SWYFT_NETWORK_PASSPHRASE_MALFORMED` | Passphrase is not a valid string |
| `SWYFT_NETWORK_PASSPHRASE_MISMATCH` | Passphrase does not match the expected network |

---

## Contract error mapping

Soroban contract failures surface as raw `code` + `message` pairs. The SDK maps
these into **typed, stable errors** so callers never have to parse contract
strings and can branch on a documented `code`.

```ts
import { mapContractError, SwyftContractError } from '@swyft/sdk/errors';

try {
  // ...invoke a contract entrypoint...
} catch (raw) {
  const err = mapContractError(raw);
  if (err instanceof SwyftContractError) {
    // err.code is a stable SDK code; err.contractCode preserves the original
    console.error(err.code, err.contractCode, err.correlationId);
  }
}
```

### Mapping rules

- The original contract `code` is preserved on `err.contractCode` and the
  original message on `err.contractMessage`.
- A `correlationId` is attached to every mapped error for observability. It is
  propagated from the caller when supplied, otherwise generated. No secrets are
  included in the payload.
- **Fail-closed:** unknown or unmapped contract codes are never swallowed and
  never treated as success. They surface as `SWYFT_CONTRACT_UNKNOWN_ERROR`.

| SDK code | Meaning |
|---|---|
| `SWYFT_CONTRACT_INVALID_ARGUMENT` | Contract rejected an argument |
| `SWYFT_CONTRACT_UNAUTHORIZED` | Caller is not authorized |
| `SWYFT_CONTRACT_INSUFFICIENT_LIQUIDITY` | Pool lacks liquidity for the operation |
| `SWYFT_CONTRACT_SLIPPAGE_EXCEEDED` | Slippage bound was exceeded |
| `SWYFT_CONTRACT_POOL_NOT_FOUND` | Referenced pool does not exist |
| `SWYFT_CONTRACT_POSITION_NOT_FOUND` | Referenced position does not exist |
| `SWYFT_CONTRACT_UNKNOWN_ERROR` | Unmapped contract code (fail-closed default) |

---

## API Reference

### Swap

| Export | Description |
|---|---|
| `buildSwapTx(params)` | Build an unsigned single-hop swap XDR envelope |
| `calculateSwapQuote(params)` | Off-chain constant-product swap estimate |
| `SwapValidationError` | Thrown when swap parameters are invalid |

### Liquidity Management

| Export | Description |
|---|---|
| `buildBurnTx(params)` | Build an unsigned remove-liquidity (burn) XDR |
| `buildCollectTx(params)` | Build an unsigned collect-fees XDR |
| `estimateRemoveAmounts(params)` | Estimate token amounts for a given liquidity removal % |
| `estimateRemoveAmountsAsync(params)` | Async version of `estimateRemoveAmounts` |
| `ValidationError` | Thrown when liquidity parameters are invalid |

### Pool Queries

| Export | Description |
|---|---|
| `getPool({ rpcUrl, poolAddress })` | Fetch pool state via Soroban RPC |
| `getPosition({ rpcUrl, positionNftId })` | Fetch position state, or `null` if not found |
| `getPositionWithLoading({ rpcUrl, positionNftId })` | Async position query (deferred microtask) |
| `getTick({ rpcUrl, poolAddress, tick })` | Fetch tick state |
| `SwyftRpcError` | Thrown when an RPC call fails |

### Network Guards

| Export | Description |
|---|---|
| `assertNetworkPassphrase(params)` | Fail-closed passphrase guard for money-path entrypoints |
| `NetworkPassphraseError` | Thrown when the passphrase is missing, malformed, or mismatched |

### Errors

| Export | Description |
|---|---|
| `mapContractError(raw, opts?)` | Map a raw contract/Soroban error into a typed SDK error |
| `SwyftContractError` | Typed error carrying `code`, `contractCode`, `contractMessage`, `correlationId` |
| `SwyftContractErrorCode` | Union of stable SDK contract error codes |

### Types

`PoolState`, `PositionState`, `TickState`, `SwapQuote`, `SwapQuoteParams`, `LocalSwapQuote`, `LocalSwapQuoteParams`, `PoolStateWithTicks`, `SwapTxParams`, `SwapUnsignedTx`, `BurnTxParams`, `BurnUnsignedTx`, `CollectTxParams`, `CollectUnsignedTx`, `UnsignedTx`, `RemoveAmountsParams`, `RemoveAmountsResult`, `PoolId`, `StellarAddress`, `RawAmount`, `XdrBase64`, `NetworkPassphraseGuardParams`, `NetworkPassphraseErrorCode`, `SwyftContractErrorCode`, `ContractErrorInput`, `MapContractErrorOptions`.

### Helpers

| Export | Description |
|---|---|
| `toStellarAddress(s)` | Cast a string to the branded `StellarAddress` type |
| `toRawAmount(s)` | Cast a string to the branded `RawAmount` type |
| `toXdrBase64(s)` | Cast a string to the branded `XdrBase64` type |
| `EMPTY_QUOTE` | Zero-value `SwapQuote` sentinel |
| `isEmptyQuote(quote)` | Returns `true` when `amountOut === '0'` |
| `EMPTY_POSITION_MESSAGE` | UI copy for empty position state |
| `config` | Shared network config (`networkPassphrase`) |

---

## Tree-shaking & entrypoints

Every submodule is published as its own subpath export, so a bundler only
includes the code your app actually imports:

```ts
import { buildSwapTx } from '@swyft/sdk';        // full barrel — still tree-shakeable
import { buildSwapTx } from '@swyft/sdk/swap';    // same function, narrower import graph
```

Available subpaths: `@swyft/sdk/quote`, `@swyft/sdk/liquidity`, `@swyft/sdk/queries`,
`@swyft/sdk/swap`, `@swyft/sdk/types`, `@swyft/sdk/config`, `@swyft/sdk/errors`.

The package sets `"sideEffects": false` and ships separate `browser` / `import`
(ESM) / `require` (CJS) conditions per entrypoint, so browser bundlers (webpack,
Vite, esbuild, Next.js/Turbopack) and Node (both `require` and native `import`)
each resolve the correct build automatically — no manual configuration needed.

---

## Advanced: On-chain Quote Simulation

For a precise quote that accounts for the full tick ladder, use `getSwapQuote` from the quote module:

```ts
import { getSwapQuote } from '@swyft/sdk/quote';
import { getPool } from '@swyft/sdk';

const poolState = await getPool({ rpcUrl: 'https://soroban-testnet.stellar.org', poolAddress: 'CPOOL...' });

const quote = getSwapQuote({
  poolState,
  tokenIn: 'CUSDC...address',
  amountIn: '1000000',
  slippage: 50, // bps
});
```

---

## Math fixtures (contract parity)

Liquidity / position math is pinned against shared golden vectors:

- **Canonical file:** [`fixtures/cl-math-vectors.json`](../../fixtures/cl-math-vectors.json)
- **Copies for package-local runs:** `packages/sdk/src/__tests__/fixtures/` and `packages/contract/fixtures/`
- **SDK tests:** `src/__tests__/contract-math-fixtures.spec.ts` (requires ≥3 vectors to pass)
- **Contract tests:** `cl-pool` `fixture_tests::tick_to_sqrt_price_matches_shared_fixtures`

### Math fixture divergence process

1. Prefer changing **one** source of truth: update `fixtures/cl-math-vectors.json`, then sync the package copies.
2. Re-run SDK tests (`pnpm --filter @swyft/sdk test`) and `cargo test -p cl-pool` (or workspace) so both sides agree on `tick_to_sqrt_price`.
3. `amounts_for_liquidity` vectors assert the **SDK** Uniswap-style range-aware formula. The on-chain `cl-pool` helper uses a simpler clamp-based variant — if those diverge intentionally, document the difference in the fixture `$schema_comment` and do **not** silently change expected amounts.
4. Extreme ticks (e.g. `-20000`) may differ (`cl-pool` saturates to `0`, SDK floors to `1`). Keep shared vectors in the overlapping safe range unless both implementations are updated together.

---

## Publishing

Releases are automated via GitHub Actions. To publish a new version:

1. Update `version` in `packages/sdk/package.json`.
2. Commit and push to `main`.
3. Create and push a tag: `git tag sdk/v0.2.0 && git push origin sdk/v0.2.0`.
4. The [`publish-sdk` workflow](../../.github/workflows/publish-sdk.yml) will build, test, and publish to npm automatically.

> Requires a repository secret `NPM_TOKEN` with publish access to `@swyft` on npm.

---

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) if it exists, or open an issue on GitHub.

## License

MIT
