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

## Related Features

- **TVL Alerts**: Users can set alerts when a pool's TVL drops below or rises above a threshold
- **Historical TVL**: Daily TVL snapshots are recorded for time series analysis
- **Fee Tracking**: Individual swap fees are tracked in the `feeAmount` field of the `Swap` model