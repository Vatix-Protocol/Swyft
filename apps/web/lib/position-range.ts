/**
 * Pure tick math for rendering a concentrated-liquidity position: range status
 * and an impermanent-loss estimate. Prices are raw token1-per-token0 ratios
 * (1.0001^tick), matching PositionSnapshot.poolCurrentPrice.
 */

import type { PositionSnapshot } from '@swyft/ui';

const TICK_BASE = 1.0001;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

/**
 * Relative tolerance for treating a price as sitting exactly on a range edge.
 * Absorbs float rounding between the API's price and 1.0001^tick while staying
 * far below one tick (~1e-4), so anything a tick outside is still out of range.
 */
const BOUNDARY_TOLERANCE = 1e-9;

export type RangeStatus = 'in-range' | 'out-of-range' | 'closed';

function clampTick(tick: number): number {
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
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

/** In range when lower price <= current price <= upper price (edges inclusive). */
export function rangeStatus(
  p: Pick<PositionSnapshot, 'status' | 'lowerTick' | 'upperTick' | 'poolCurrentPrice'>,
): RangeStatus {
  if (p.status === 'closed') return 'closed';
  const lower = tickToPrice(p.lowerTick);
  const upper = tickToPrice(p.upperTick);
  const price = p.poolCurrentPrice;
  const aboveLower = price >= lower * (1 - BOUNDARY_TOLERANCE);
  const belowUpper = price <= upper * (1 + BOUNDARY_TOLERANCE);
  return aboveLower && belowUpper ? 'in-range' : 'out-of-range';
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
  p: Pick<PositionSnapshot, 'lowerTick' | 'upperTick' | 'poolCurrentPrice'>,
): number {
  const price = p.poolCurrentPrice;
  if (!Number.isFinite(price) || price <= 0 || p.upperTick <= p.lowerTick) return 0;

  const sqrtLower = tickToSqrtPrice(p.lowerTick);
  const sqrtUpper = tickToSqrtPrice(p.upperTick);
  const sqrtDeposit = Math.sqrt(rangeMidpointPrice(p));
  const sqrtCurrent = Math.min(sqrtUpper, Math.max(sqrtLower, Math.sqrt(price)));

  const holdValue = (1 / sqrtDeposit - 1 / sqrtUpper) * price + (sqrtDeposit - sqrtLower);
  // LP value minus hold value; written as a difference so it is exactly 0 at the deposit price.
  const lpMinusHold =
    (1 / sqrtCurrent - 1 / sqrtDeposit) * price + (sqrtCurrent - sqrtDeposit);
  if (!(holdValue > 0)) return 0;

  const il = lpMinusHold / holdValue;
  // LP value is concave and the hold value is its tangent at the deposit price, so
  // IL is never positive; clamp float noise (and -0) to exactly 0.
  return il < 0 ? il : 0;
}
