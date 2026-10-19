import { describe, expect, it } from 'vitest';
import type { PositionSnapshot } from '@swyft/ui';
import {
  estimateImpermanentLoss,
  rangeMidpointPrice,
  rangeStatus,
  tickToPrice,
} from './position-range';

const LOWER_TICK = -1000;
const UPPER_TICK = 1000;

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'pos-1',
    ownerWallet: 'GTEST',
    poolId: 'pool-1',
    token0: 'XLM',
    token1: 'USDC',
    lowerTick: LOWER_TICK,
    upperTick: UPPER_TICK,
    liquidity: '1000',
    currentValueUsd: 100,
    uncollectedFeesToken0: '0',
    uncollectedFeesToken1: '0',
    createdAt: 1_700_000_000,
    closedAt: null,
    status: 'active',
    poolCurrentPrice: 1,
    ...overrides,
  };
}

describe('rangeStatus', () => {
  const lowerPrice = tickToPrice(LOWER_TICK);
  const upperPrice = tickToPrice(UPPER_TICK);

  it('is out-of-range when the price is below the lower tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: lowerPrice * 0.999 }))).toBe('out-of-range');
  });

  it('is in-range when the price equals the lower tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: lowerPrice }))).toBe('in-range');
  });

  it('is in-range when the price is strictly inside the range', () => {
    expect(rangeStatus(position({ poolCurrentPrice: 1 }))).toBe('in-range');
  });

  it('is in-range when the price equals the upper tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: upperPrice }))).toBe('in-range');
  });

  it('is out-of-range when the price is above the upper tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: upperPrice * 1.001 }))).toBe('out-of-range');
  });

  it('is closed for closed positions regardless of price', () => {
    expect(rangeStatus(position({ status: 'closed', closedAt: 1_700_000_100 }))).toBe('closed');
  });

  it('clamps ticks beyond the protocol bounds instead of overflowing', () => {
    const p = position({ lowerTick: -10_000_000, upperTick: 10_000_000, poolCurrentPrice: 1e30 });
    expect(Number.isFinite(tickToPrice(p.upperTick))).toBe(true);
    expect(tickToPrice(p.lowerTick)).toBeGreaterThan(0);
    expect(rangeStatus(p)).toBe('in-range');
  });
});

describe('estimateImpermanentLoss', () => {
  it('is exactly 0 at the range midpoint', () => {
    const p = position({ poolCurrentPrice: rangeMidpointPrice(position()) });
    expect(estimateImpermanentLoss(p)).toBe(0);
  });

  it('is exactly 0 at the midpoint of an asymmetric range', () => {
    const range = { lowerTick: 0, upperTick: 2000 };
    const p = position({ ...range, poolCurrentPrice: rangeMidpointPrice(range) });
    expect(estimateImpermanentLoss(p)).toBe(0);
  });

  it('matches the known value for a 4x move away from the midpoint', () => {
    // Midpoint of [-1000, 1000] is price 1; r = 4 → 2·√4/(1+4) − 1 = −0.2.
    expect(estimateImpermanentLoss(position({ poolCurrentPrice: 4 }))).toBeCloseTo(-0.2, 12);
  });

  it('is negative for prices on either side of the midpoint', () => {
    for (const price of [0.01, 0.5, 0.99, 1.01, 2, 100]) {
      expect(estimateImpermanentLoss(position({ poolCurrentPrice: price }))).toBeLessThan(0);
    }
  });

  it('returns 0 when the pool price is not a positive finite number', () => {
    expect(estimateImpermanentLoss(position({ poolCurrentPrice: 0 }))).toBe(0);
    expect(estimateImpermanentLoss(position({ poolCurrentPrice: -1 }))).toBe(0);
    expect(estimateImpermanentLoss(position({ poolCurrentPrice: Number.NaN }))).toBe(0);
  });
});
