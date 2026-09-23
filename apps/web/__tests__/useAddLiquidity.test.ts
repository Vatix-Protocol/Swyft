import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAddLiquidity, tickToPrice } from '@/hooks/useAddLiquidity';

const mockPool = {
  id: 'pool-1',
  token0: { address: 'TOKEN0', symbol: 'XLM', name: 'Stellar', decimals: 7 },
  token1: { address: 'TOKEN1', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  token0Symbol: 'XLM',
  token1Symbol: 'USDC',
  feeTier: '0.30%',
  currentPrice: 1.0,
  currentTick: 0,
  currentSqrtPrice: '79228162514264337593543950336',
  totalLiquidity: '1000000',
  tvl: 1000000,
  volume24h: '500000',
  volume7d: '3500000',
  feeApr: 10.0,
  creationTimestamp: 1700000000,
  recentSwaps: [],
};

describe('useAddLiquidity — amount sync with range', () => {
  it('recalculates amount1 when lowerTick changes and amount0 is set', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount0('100'));

    const amount1Before = result.current.amount1;

    act(() => result.current.setLowerTick(result.current.lowerTick - 120));

    // amount0 should remain the same
    expect(result.current.amount0).toBe('100');
    // amount1 should have changed
    expect(result.current.amount1).not.toBe(amount1Before);
  });

  it('recalculates amount1 when upperTick changes and amount0 is set', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount0('100'));

    const amount1Before = result.current.amount1;

    act(() => result.current.setUpperTick(result.current.upperTick + 120));

    expect(result.current.amount0).toBe('100');
    expect(result.current.amount1).not.toBe(amount1Before);
  });

  it('recalculates amount0 when range changes and amount1 was last edited', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount1('50'));

    const amount0Before = result.current.amount0;

    act(() => result.current.setLowerTick(result.current.lowerTick - 120));

    // amount1 should remain as the user entered it
    expect(result.current.amount1).toBe('50');
    // amount0 should have been recalculated
    expect(result.current.amount0).not.toBe(amount0Before);
  });

  it('recalculates amounts when setLowerPrice changes the range', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount0('100'));

    const amount1Before = result.current.amount1;

    act(() => result.current.setLowerPrice('0.5'));

    expect(result.current.amount0).toBe('100');
    expect(result.current.amount1).not.toBe(amount1Before);
  });

  it('recalculates amounts when setUpperPrice changes the range', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount0('100'));

    const amount1Before = result.current.amount1;

    act(() => result.current.setUpperPrice('2.0'));

    expect(result.current.amount0).toBe('100');
    expect(result.current.amount1).not.toBe(amount1Before);
  });

  it('recalculates amounts on setFullRange', () => {
    const { result } = renderHook(() => useAddLiquidity());

    // Use a non-symmetric price so the range change produces a different amount1
    const asymmetricPool = { ...mockPool, currentPrice: 2.5 };
    act(() => result.current.setPool(asymmetricPool as any));
    act(() => result.current.setAmount0('100'));

    const amount1Before = result.current.amount1;

    act(() => result.current.setFullRange());

    expect(result.current.amount0).toBe('100');
    // Full range changes the range dramatically, so amount1 should differ
    expect(result.current.amount1).not.toBe(amount1Before);
  });

  it('does not change amounts when no amounts are entered', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));

    // Both amounts should be empty
    expect(result.current.amount0).toBe('');
    expect(result.current.amount1).toBe('');

    act(() => result.current.setLowerTick(result.current.lowerTick - 120));

    expect(result.current.amount0).toBe('');
    expect(result.current.amount1).toBe('');
  });

  it('clears amount1 when out-of-range (price below lower bound)', () => {
    const { result } = renderHook(() => useAddLiquidity());

    // Pool with currentPrice = 1.0
    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount0('100'));

    // Move lower tick above currentPrice so the position is out of range
    // (currentPrice < lowerPrice means only token0 is needed, amount1 = 0)
    const highTick = 6000; // tickToPrice(6000) ~ 1.82
    act(() => result.current.setLowerTick(highTick));

    // amount1 should be empty because it's out of range
    expect(result.current.amount1).toBe('');
  });

  it('in-range deposit computes the second amount', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => result.current.setPool(mockPool as any));
    act(() => result.current.setAmount0('100'));

    // amount1 should be computed (non-empty for in-range)
    expect(result.current.amount1).not.toBe('');
    expect(parseFloat(result.current.amount1)).toBeGreaterThan(0);
  });
});
