import { describe, it, expect } from 'vitest';
import type { PositionSnapshot } from '@swyft/ui';
import { estimateImpermanentLoss, rangeStatus, tickToPrice } from './position-range';

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

describe('position-range', () => {
  it('tickToPrice returns 1.0001^tick', () => {
    expect(tickToPrice(0)).toBe(1);
    expect(tickToPrice(1)).toBeCloseTo(1.0001, 12);
    expect(tickToPrice(-1)).toBeCloseTo(1 / 1.0001, 12);
  });

  it('tickToPrice is strictly increasing across ascending ticks', () => {
    const prices = [0, 1, 100].map(tickToPrice);
    expect(prices[0]).toBeLessThan(prices[1]);
    expect(prices[1]).toBeLessThan(prices[2]);
  });

  it('reports a position whose current tick is inside the range as in-range', () => {
    const p = position({ poolCurrentPrice: tickToPrice(0) });
    expect(rangeStatus(p)).toBe('in-range');
    expect(estimateImpermanentLoss(p)).toBe(0);
  });

  it('reports a position whose current tick is outside the range as out-of-range', () => {
    const p = position({ poolCurrentPrice: tickToPrice(UPPER_TICK + 1) });
    expect(rangeStatus(p)).toBe('out-of-range');
    expect(estimateImpermanentLoss(p)).toBeLessThan(0);
  });
});
