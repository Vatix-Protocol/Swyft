import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAddLiquidity } from '@/hooks/useAddLiquidity';
import type { PoolDetail } from '@/hooks/usePoolTicks';

function makePool(overrides: Partial<PoolDetail> = {}): PoolDetail {
  return {
    id: 'pool-1',
    token0: 'XLM',
    token1: 'USDC',
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    feeTier: '0.30%',
    currentPrice: 0.1,
    currentTick: -22000,
    tvl: 1_000_000,
    feeApr: 12.4,
    volume24h: 340_000,
    ...overrides,
  };
}

describe('useAddLiquidity preview.estimatedApr', () => {
  it('is "—" when no pool is selected', () => {
    const { result } = renderHook(() => useAddLiquidity());
    expect(result.current.preview.estimatedApr).toBe('—');
  });

  it('computes a numeric APR when the pool has feeApr and volume24h data', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => {
      result.current.setPool(makePool());
    });

    expect(result.current.preview.estimatedApr).not.toBe('N/A');
    expect(Number.isNaN(Number(result.current.preview.estimatedApr))).toBe(false);
  });

  it('is "N/A" when volume24h is missing', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => {
      result.current.setPool(makePool({ volume24h: undefined as unknown as number }));
    });

    expect(result.current.preview.estimatedApr).toBe('N/A');
  });

  it('is "N/A" when feeApr is missing', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => {
      result.current.setPool(makePool({ feeApr: undefined as unknown as number }));
    });

    expect(result.current.preview.estimatedApr).toBe('N/A');
  });

  it('is "N/A" when feeApr is NaN', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => {
      result.current.setPool(makePool({ feeApr: NaN }));
    });

    expect(result.current.preview.estimatedApr).toBe('N/A');
  });

  it('still computes a real APR for a confirmed zero-volume pool (defined, not missing)', () => {
    const { result } = renderHook(() => useAddLiquidity());

    act(() => {
      result.current.setPool(makePool({ volume24h: 0, feeApr: 0 }));
    });

    expect(result.current.preview.estimatedApr).toBe('0.0');
  });
});
