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

### Types

`PoolState`, `PositionState`, `TickState`, `SwapQuote`, `SwapQuoteParams`, `LocalSwapQuote`, `LocalSwapQuoteParams`, `PoolStateWithTicks`, `SwapTxParams`, `SwapUnsignedTx`, `BurnTxParams`, `BurnUnsignedTx`, `CollectTxParams`, `CollectUnsignedTx`, `UnsignedTx`, `RemoveAmountsParams`, `RemoveAmountsResult`, `PoolId`, `StellarAddress`, `RawAmount`, `XdrBase64`.

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

## Advanced: On-chain Quote Simulation

For a precise quote that accounts for the full tick ladder, use `getSwapQuote` from the quote module:

```ts
import { getSwapQuote } from '@swyft/sdk/dist/esm/quote';
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
