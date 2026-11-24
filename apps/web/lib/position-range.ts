/**
 * Pure tick math for rendering a concentrated-liquidity position: range status
 * and an impermanent-loss estimate. Prices are raw token1-per-token0 ratios
 * (1.0001^tick), matching PositionSnapshot.poolCurrentPrice.
 */

import type { PositionSnapshot } from '@swyft/ui';

const TICK_BASE = 1.0001;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

export type RangeStatus = 'in-range' | 'out-of-range' | 'closed';

function clampTick(tick: number): number {
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
}

const POSITIVE_DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/;

/**
 * Tick for a typed price string, clamped to the protocol's valid range.
 * Returns null unless the text is a positive decimal (e.g. "", "abc", "0", "-1").
 */
export function priceToTick(price: string): number | null {
  const text = price.trim();
  if (!POSITIVE_DECIMAL.test(text)) return null;
  const p = Number(text);
  if (!(p > 0) || !Number.isFinite(p)) return null;
  return clampTick(Math.round(Math.log(p) / Math.log(TICK_BASE)));
}

/** Price at a tick, with the tick clamped to the protocol's valid range. */
export function tickToPrice(tick: number): number {
  return Math.pow(TICK_BASE, clampTick(tick));
}

/** sqrt(price) at a tick, derived from the tick directly rather than sqrt(1.0001^tick). */
export function tickToSqrtPrice(tick: number): number {
  return Math.pow(TICK_BASE, clampTick(tick) / 2);
}

/**
 * Geometric midpoint price of the position's range, used as the deposit-price
 * proxy for the IL estimate (the price at which the position holds equal value
 * on both sides of its range in sqrt-price space).
 */
export function rangeMidpointPrice(p: Pick<PositionSnapshot, 'lowerTick' | 'upperTick'>): number {
  const sqrtMid = Math.sqrt(tickToSqrtPrice(p.lowerTick) * tickToSqrtPrice(p.upperTick));
  return sqrtMid * sqrtMid;
}

/**
 * Input for {@link rangeStatus}. `currentTick` is the pool's tick; the legacy
 * `poolCurrentPrice` is converted to a tick only when no tick is supplied.
 */
type RangeStatusInput = Pick<PositionSnapshot, 'status' | 'lowerTick' | 'upperTick'> & {
  currentTick?: number;
  poolCurrentPrice?: number;
};

/**
 * In range when lowerTick <= currentTick < upperTick.
 *
 * The upper tick is exclusive, matching the pool's mint rule (a position is
 * active only while `tick < tick_upper`); the lower tick is inclusive.
 */
export function rangeStatus(p: RangeStatusInput, tickOverride?: number): RangeStatus {
  if (p.status === 'closed') return 'closed';
  const tick =
    tickOverride ??
    p.currentTick ??
    (p.poolCurrentPrice != null ? priceToTick(String(p.poolCurrentPrice)) : null);
  if (tick == null || !Number.isFinite(tick) || p.upperTick <= p.lowerTick) return 'out-of-range';
  return tick >= p.lowerTick && tick < p.upperTick ? 'in-range' : 'out-of-range';
}

/**
 * Impermanent-loss estimate for a concentrated-liquidity position vs holding
 * the tokens deposited at the range midpoint price. Returned as a fraction
 * (e.g. -0.012 = -1.2%): 0 at the midpoint, negative at any other price.
 *
 * Token amounts per unit of liquidity at sqrt price s (clamped to the range):
 *   x = 1/s - 1/sqrtUpper,  y = s - sqrtLower
 * valued in token1 at the current price.
 */
export function estimateImpermanentLoss(
  p: Pick<PositionSnapshot, 'lowerTick' | 'upperTick' | 'poolCurrentPrice' | 'liquidity'>
): number {
  const price = p.poolCurrentPrice;
  let liquidity: bigint;
  try {
    liquidity = BigInt(p.liquidity);
  } catch {
    return 0;
  }
  if (liquidity <= 0n || !Number.isFinite(price) || price <= 0 || p.upperTick <= p.lowerTick) {
    return 0;
  }
  const entryPrice = rangeMidpointPrice(p);
  if (Math.abs(price - entryPrice) <= Number.EPSILON * Math.max(price, entryPrice) * 8) {
    return 0;
  }

  const sqrtLower = tickToSqrtPrice(p.lowerTick);
  const sqrtUpper = tickToSqrtPrice(p.upperTick);
  const sqrtDeposit = Math.sqrt(rangeMidpointPrice(p));
  const sqrtCurrent = Math.min(sqrtUpper, Math.max(sqrtLower, Math.sqrt(price)));

  const holdValue = (1 / sqrtDeposit - 1 / sqrtUpper) * price + (sqrtDeposit - sqrtLower);
  // LP value minus hold value; written as a difference so it is exactly 0 at the deposit price.
  const lpMinusHold = (1 / sqrtCurrent - 1 / sqrtDeposit) * price + (sqrtCurrent - sqrtDeposit);
  if (!(holdValue > 0)) return 0;

  const il = lpMinusHold / holdValue;
  // LP value is concave and the hold value is its tangent at the deposit price, so
  // IL is never positive; clamp float noise (and -0) to exactly 0.
  return il < -1e-12 ? il : 0;
}
