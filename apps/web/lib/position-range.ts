/**
 * Pure tick math for rendering concentrated-liquidity positions.
 *
 * Prices are token1/token0, derived from ticks as `1.0001^tick`. Ticks are
 * clamped to the protocol's [MIN_TICK, MAX_TICK] bounds so out-of-range input
 * cannot overflow to Infinity or underflow to 0.
 */

import type { PositionSnapshot } from '@swyft/ui';

const TICK_BASE = 1.0001;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

export type PositionRangeStatus = 'in-range' | 'out-of-range' | 'closed';

/** Price (token1/token0) at the given tick, clamped to valid tick bounds. */
export function tickToPrice(tick: number): number {
  const clamped = Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
  return Math.pow(TICK_BASE, clamped);
}

/**
 * Geometric midpoint of the position's price range, i.e. the price at the
 * middle tick (`sqrt(lowerPrice * upperPrice)`).
 */
export function rangeMidpointPrice(p: Pick<PositionSnapshot, 'lowerTick' | 'upperTick'>): number {
  return tickToPrice((p.lowerTick + p.upperTick) / 2);
}

/**
 * Whether the pool price sits inside the position's range. Both boundaries are
 * inclusive: a price exactly equal to the lower or upper tick price is in range.
 */
export function rangeStatus(
  p: Pick<PositionSnapshot, 'status' | 'lowerTick' | 'upperTick' | 'poolCurrentPrice'>
): PositionRangeStatus {
  if (p.status === 'closed') return 'closed';
  const lower = tickToPrice(p.lowerTick);
  const upper = tickToPrice(p.upperTick);
  return p.poolCurrentPrice >= lower && p.poolCurrentPrice <= upper ? 'in-range' : 'out-of-range';
}

/**
 * Rough impermanent-loss estimate vs a hold-at-deposit baseline, using the
 * range midpoint price as a proxy for the deposit price (constant-product
 * approximation). Returned as a non-positive fraction (e.g. -0.012 = -1.2%):
 * exactly 0 at the range midpoint and negative for any other positive price.
 * Returns 0 when the pool price is not a positive finite number.
 */
export function estimateImpermanentLoss(
  p: Pick<PositionSnapshot, 'lowerTick' | 'upperTick' | 'poolCurrentPrice'>
): number {
  if (!Number.isFinite(p.poolCurrentPrice) || p.poolCurrentPrice <= 0) return 0;
  const priceRatio = p.poolCurrentPrice / rangeMidpointPrice(p);
  // Equivalent to 2*sqrt(r)/(1+r) - 1, written so it can never round above 0.
  const il = -((Math.sqrt(priceRatio) - 1) ** 2) / (1 + priceRatio);
  // Normalise -0 to 0.
  return il === 0 ? 0 : il;
}
