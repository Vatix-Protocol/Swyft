/**
 * Tick math unit tests — issue #261
 *
 * Covers priceToTick, tickToPrice, tickToSqrtPriceX96, and sqrtPriceX96ToTick
 * from position-math.ts.
 */

import {
  priceToTick,
  tickToPrice,
  tickToSqrtPriceX96,
  sqrtPriceX96ToTick,
  Q96,
  MIN_TICK,
  MAX_TICK,
} from '../position-math';

describe('priceToTick', () => {
  it('returns tick 0 for price 1 (any tickSpacing)', () => {
    expect(priceToTick(1, 1)).toBe(0);
    expect(priceToTick(1, 60)).toBe(0);
  });

  it('snaps to tickSpacing', () => {
    const tick = priceToTick(1.5, 60);
    expect(tick % 60).toBe(0);
  });

  it('returns a positive tick for price > 1', () => {
    expect(priceToTick(2, 1)).toBeGreaterThan(0);
  });

  it('returns a negative tick for price < 1', () => {
    expect(priceToTick(0.5, 1)).toBeLessThan(0);
  });

  it('clamps to MIN_TICK for extremely small price', () => {
    expect(priceToTick(1e-40, 1)).toBe(MIN_TICK);
  });

  it('clamps to MAX_TICK for extremely large price', () => {
    expect(priceToTick(1e40, 1)).toBe(MAX_TICK);
  });

  it('throws RangeError for price <= 0', () => {
    expect(() => priceToTick(0, 1)).toThrow(RangeError);
    expect(() => priceToTick(-1, 1)).toThrow(/price must be positive/i);
  });
});

describe('tickToPrice', () => {
  it('returns 1 for tick 0 with equal decimals', () => {
    expect(tickToPrice(0, 6, 6)).toBeCloseTo(1, 10);
  });

  it('returns > 1 for positive tick with equal decimals', () => {
    expect(tickToPrice(1000, 6, 6)).toBeGreaterThan(1);
  });

  it('returns < 1 for negative tick with equal decimals', () => {
    expect(tickToPrice(-1000, 6, 6)).toBeLessThan(1);
  });

  it('adjusts for decimal difference (token0 more decimals)', () => {
    // 10^(8-6) = 100x scaling
    expect(tickToPrice(0, 8, 6)).toBeCloseTo(100, 5);
  });

  it('adjusts for decimal difference (token1 more decimals)', () => {
    expect(tickToPrice(0, 6, 8)).toBeCloseTo(0.01, 8);
  });

  it('is approximately the inverse of priceToTick for round-trip', () => {
    const price = 1.5;
    const tick = priceToTick(price, 1);
    const recovered = tickToPrice(tick, 6, 6);
    // Allow tolerance due to tick snapping
    expect(recovered).toBeCloseTo(price, 1);
  });
});

describe('tickToSqrtPriceX96', () => {
  it('returns Q96 for tick 0', () => {
    expect(tickToSqrtPriceX96(0)).toBe(Q96);
  });

  it('returns > Q96 for positive tick', () => {
    expect(tickToSqrtPriceX96(1000)).toBeGreaterThan(Q96);
  });

  it('returns < Q96 for negative tick', () => {
    expect(tickToSqrtPriceX96(-1000)).toBeLessThan(Q96);
  });

  it('returns a positive value for negative tick', () => {
    expect(tickToSqrtPriceX96(-1000)).toBeGreaterThan(0n);
  });

  it('throws RangeError for tick below MIN_TICK', () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1)).toThrow(RangeError);
  });

  it('throws RangeError for tick above MAX_TICK', () => {
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1)).toThrow(RangeError);
  });

  it('accepts MIN_TICK and MAX_TICK without throwing', () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK)).not.toThrow();
    expect(() => tickToSqrtPriceX96(MAX_TICK)).not.toThrow();
  });
});

describe('sqrtPriceX96ToTick', () => {
  it('returns 0 for Q96', () => {
    expect(sqrtPriceX96ToTick(Q96)).toBe(0);
  });

  it('returns positive tick for sqrtPrice > Q96', () => {
    expect(sqrtPriceX96ToTick(Q96 + Q96 / 20n)).toBeGreaterThan(0);
  });

  it('returns negative tick for sqrtPrice < Q96', () => {
    expect(sqrtPriceX96ToTick(Q96 - Q96 / 20n)).toBeLessThan(0);
  });

  it('throws RangeError for sqrtPrice <= 0', () => {
    expect(() => sqrtPriceX96ToTick(0n)).toThrow(RangeError);
    expect(() => sqrtPriceX96ToTick(-1n)).toThrow(RangeError);
  });

  it('round-trips with tickToSqrtPriceX96 within 1 tick (linear approximation)', () => {
    // The on-chain linear approximation uses integer division, so the round-trip
    // may be off by at most 1 tick due to bigint truncation.
    for (const tick of [0, 100, -100, 5000, -5000]) {
      const sqrtPrice = tickToSqrtPriceX96(tick);
      const recovered = sqrtPriceX96ToTick(sqrtPrice);
      expect(Math.abs(recovered - tick)).toBeLessThanOrEqual(1);
    }
  });
});
