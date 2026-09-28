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
   are rejected before persistence rather than converted to plausible values.
6. **Deterministic**: the same `(fees24h, tvl)` pair always produces the same
   `feeApr`; the function is pure and has no hidden state.

## Calculation Details

### 1. Fees 24h Calculation

The 24-hour fees are calculated as:

```typescript
const fees24h = swaps24h.reduce(
  (sum: number, s: Swap) => sum + calculateSwapFeesUsd(s.feeAmount, token0Decimals, token0UsdPrice),
  0
);
```

- Each swap's `feeAmount` is derived from the transaction amount and the pool's fee tier
- `feeAmount` is in token0 base units and is divided by `10 ** token0Decimals`
  before applying token0's cached USD price
- The rolling window is half-open: `[aggregationTime - 24 hours, aggregationTime)`.
  Swaps at the lower bound are included; future-dated swaps are excluded.

### 2. TVL Calculation

The API reconstructs token reserves by summing every open indexed position at
the pool's current Q64.96 sqrt price and the position's lower/upper ticks. It
uses the SDK's integer concentrated-liquidity amount math, then converts base
units using each token's indexed decimals:

```typescript
const { amount0, amount1 } = getAmountsForLiquidity({
  sqrtPriceX96: BigInt(pool.currentSqrtPrice),
  sqrtPriceLowerX96: tickToSqrtPriceX96(position.lowerTick),
  sqrtPriceUpperX96: tickToSqrtPriceX96(position.upperTick),
  liquidity: BigInt(position.liquidity),
});
const tvl =
  (Number(amount0) / 10 ** decimals0) * priceA + (Number(amount1) / 10 ** decimals1) * priceB;
```

- `pool.currentSqrtPrice`: The indexed current sqrt price, Q64.96 fixed point
- `position.lowerTick` / `position.upperTick`: Each open position's range
- `position.liquidity`: The position's indexed liquidity
- `decimals0`, `decimals1`: Decimals of token0 and token1, used to convert
  raw reserve amounts into human-readable units
- `priceA`, `priceB`: Current USD prices of the two tokens in the pool
- Closed positions are excluded. Missing token metadata or missing, zero, or
  invalid USD prices fail that pool's update rather than fabricating a value.

### 3. Edge Cases

- **Zero TVL**: If `tvl = 0`, then `feeApr = 0` to avoid division by zero
- **No Swaps in 24h**: If there are no swaps in the last 24 hours, `fees24h = 0` and `feeApr = 0`
- **Invalid inputs**: Non-finite amounts, invalid decimals, or missing prices
  fail the pool update instead of being converted to zero
- **Missing price feed**: The pool update is skipped; stale or fabricated TVL
  and APR values are not written.

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
// Calculate fees in USD from token0 base units over [now - 24h, now)
const fees24h = swaps24h.reduce(
  (sum: number, s: Swap) => sum + calculateSwapFeesUsd(s.feeAmount, token0Decimals, priceA),
  0
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

The API stores and returns this result in **percentage points**. For example,
`36.5` means `36.5%`, not `0.365`; web clients must display the value directly
and must not multiply it by 100 again.

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
