import { describe, it, expect } from 'vitest';
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
    ownerWallet: 'GABC',
    poolId: 'pool-1',
    token0: 'XLM',
    token1: 'USDC',
    lowerTick: LOWER_TICK,
    upperTick: UPPER_TICK,
    liquidity: '1000',
    currentValueUsd: 100,
    uncollectedFeesToken0: '0',
    uncollectedFeesToken1: '0',
    createdAt: 1700000000,
    closedAt: null,
    status: 'active',
    poolCurrentPrice: 1,
    ...overrides,
  };
}

describe('rangeStatus', () => {
  it('is out-of-range when price is below the lower tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: tickToPrice(LOWER_TICK - 1) }))).toBe(
      'out-of-range',
    );
  });

  it('is in-range when price equals the lower tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: tickToPrice(LOWER_TICK) }))).toBe('in-range');
  });

  it('is in-range when price is inside the range', () => {
    expect(rangeStatus(position({ poolCurrentPrice: 1 }))).toBe('in-range');
  });

  it('is in-range when price equals the upper tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: tickToPrice(UPPER_TICK) }))).toBe('in-range');
  });

  it('is out-of-range when price is above the upper tick price', () => {
    expect(rangeStatus(position({ poolCurrentPrice: tickToPrice(UPPER_TICK + 1) }))).toBe(
      'out-of-range',
    );
  });

  it('is closed for a closed position regardless of price', () => {
    expect(rangeStatus(position({ status: 'closed', poolCurrentPrice: 1 }))).toBe('closed');
  });
});

describe('estimateImpermanentLoss', () => {
  it('is exactly 0 at the range midpoint', () => {
    const p = position();
    expect(estimateImpermanentLoss({ ...p, poolCurrentPrice: rangeMidpointPrice(p) })).toBe(0);
  });

  it('is exactly 0 at the midpoint of an asymmetric range', () => {
    const p = position({ lowerTick: 100, upperTick: 7000 });
    expect(estimateImpermanentLoss({ ...p, poolCurrentPrice: rangeMidpointPrice(p) })).toBe(0);
  });

  it('matches the known concentrated-liquidity value off the midpoint', () => {
    // Range [-1000, 1000], deposit at price 1, price moved to tick 500.
    const il = estimateImpermanentLoss(position({ poolCurrentPrice: tickToPrice(500) }));
    expect(il).toBeCloseTo(-0.0064055557739596, 12);
  });

  it('reduces to the constant-product value (-20% at a 4x move) over the full tick range', () => {
    const full = { lowerTick: -887272, upperTick: 887272 };
    expect(estimateImpermanentLoss(position({ ...full, poolCurrentPrice: 4 }))).toBeCloseTo(-0.2, 12);
    expect(estimateImpermanentLoss(position({ ...full, poolCurrentPrice: 0.25 }))).toBeCloseTo(
      -0.2,
      12,
    );
  });

  it('is negative for any positive price other than the midpoint, in or out of range', () => {
    const prices = [
      1e-12,
      0.5,
      tickToPrice(LOWER_TICK),
      0.99999,
      1.00001,
      tickToPrice(UPPER_TICK),
      3,
      1e12,
    ];
    for (const poolCurrentPrice of prices) {
      expect(estimateImpermanentLoss(position({ poolCurrentPrice }))).toBeLessThan(0);
    }
  });
});
