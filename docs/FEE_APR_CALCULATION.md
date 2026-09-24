# Fee APR Calculation

## Overview

The fee APR (Annual Percentage Rate) for each pool is calculated based on the fees collected over the last 24 hours, projected annually, and expressed as a percentage of the pool's Total Value Locked (TVL).

## Formula

```
feeApr = (fees24h / tvl) * 365 * 100
```

Where:
- `fees24h`: Total fees collected in the pool over the last 24 hours (in USD)
- `tvl`: Total Value Locked in the pool (in USD)
- `365`: Days in a year (annual projection)
- `100`: Convert to percentage

## Invariants

These invariants are the contract for the fee APR path. Any change to the
implementation MUST preserve them, and they are asserted by the tests in
`apps/api/src/stats/stats.worker.spec.ts`.

1. **Non-negative**: `feeApr >= 0` for all inputs. Fees and TVL are never
   negative, so the ratio cannot be negative.
2. **Zero TVL is fail-closed**: when `tvl <= 0` (or non-finite), `feeApr = 0`.
   The calculation never divides by zero and never emits `Infinity`/`NaN`.
3. **Zero fees is zero APR**: when `fees24h = 0`, `feeApr = 0`.
4. **Monotonic in fees**: for a fixed `tvl > 0`, a larger `fees24h` yields a
   larger-or-equal `feeApr`.
5. **Finite output**: `feeApr` is always a finite number; non-finite inputs
   (`NaN`, `Infinity`) are treated as `0` rather than propagated.
6. **Deterministic**: the same `(fees24h, tvl)` pair always produces the same
   `feeApr`; the function is pure and has no hidden state.

## Calculation Details

### 1. Fees 24h Calculation

The 24-hour fees are calculated as:

```typescript
const fees24h = swaps24h.reduce(
  (sum: number, s: Swap) => sum + Number(s.feeAmount) * tokenPrice,
  0,
);
```

- Each swap's `feeAmount` is derived from the transaction amount and the pool's fee tier
- Fees are converted to USD using the token's current price
- Only swaps from the last 24 hours are included

### 2. TVL Calculation

The TVL is calculated from the pool's actual on-chain reserves at the current
tick, using the concentrated-liquidity virtual-reserve formulas:

```typescript
const sqrtPrice = Number(pool.currentSqrtPrice) / 2 ** 96;
const liquidity = Number(pool.liquidity);
const reserve0 = liquidity / sqrtPrice / 10 ** decimals0;
const reserve1 = (liquidity * sqrtPrice) / 10 ** decimals1;
const tvl = reserve0 * priceA + reserve1 * priceB;
```

- `pool.liquidity`: The in-range liquidity (L) at the pool's current tick
- `pool.currentSqrtPrice`: The current sqrt price, Q64.96 fixed point
- `decimals0`, `decimals1`: Decimals of token0 and token1, used to convert
  raw reserve amounts into human-readable units
- `priceA`, `priceB`: Current USD prices of the two tokens in the pool
- Each token's reserve is priced independently and summed, rather than
  approximating the pool's value with `liquidity * average price`

### 3. Edge Cases

- **Zero TVL**: If `tvl = 0`, then `feeApr = 0` to avoid division by zero
- **No Swaps in 24h**: If there are no swaps in the last 24 hours, `fees24h = 0` and `feeApr = 0`
- **Non-finite inputs**: If `fees24h` or `tvl` is `NaN`/`Infinity` (e.g. a
  missing price feed), the result is `0` rather than a non-finite APR

## Update Frequency

The fee APR is updated every 5 minutes by the `StatsWorker` as part of the pool stats aggregation job.

## Example

Given:
- Total fees collected in last 24 hours: $1,000 USD
- Pool TVL: $1,000,000 USD

Calculation:
```
feeApr = ($1,000 / $1,000,000) * 365 * 100
       = 0.001 * 365 * 100
       = 36.5%
```

The pool's fee APR would be 36.5%.

## Implementation

The fee APR calculation is implemented in `/workspaces/Swyft/apps/api/src/stats/stats.worker.ts`:

```typescript
// Calculate fees collected in last 24 hours
const fees24h = swaps24h.reduce(
  (sum: number, s: Swap) => sum + Number(s.feeAmount) * priceA,
  0,
);

// Calculate fee APR
const feeApr = tvl > 0 ? (fees24h / tvl) * 365 * 100 : 0;

// Store in database
await this.prisma.pool.update({
  where: { id: pool.id },
  data: {
    tvl: String(tvl),
    volume24h: String(volume24h),
    feeApr: String(feeApr),
  },
});
```

## Testing

The invariants above are covered by unit tests in
`apps/api/src/stats/stats.worker.spec.ts`:

- `feeApr` is `0` when TVL is `0` (fail-closed, no division by zero)
- `feeApr` is `0` when there are no swaps in the last 24 hours
- `feeApr` matches the documented formula for a known `(fees24h, tvl)` pair
- `feeApr` is non-negative and finite for adversarial inputs (`NaN`,
  `Infinity`, negative values)
- `feeApr` is monotonic in `fees24h` for a fixed `tvl`

Run them with:

```
pnpm --filter @swyft/api test stats.worker
```

## Related Features

- **TVL Alerts**: Users can set alerts when a pool's TVL drops below or rises above a threshold
- **Historical TVL**: Daily TVL snapshots are recorded for time series analysis
- **Fee Tracking**: Individual swap fees are tracked in the `feeAmount` field of the `Swap` model