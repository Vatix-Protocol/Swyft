import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTokens, usePoolId } from '../hooks/useTokens';
import { apiFetch } from '../lib/api-fetch';

vi.mock('../lib/api-fetch', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

const tokens = [
  { address: '0x1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  { address: '0x2', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('useTokens', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('surfaces an error on failure and recovers via refetch', async () => {
    mockedApiFetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(tokens));

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.tokens).toEqual([]);

    act(() => {
      result.current.refetch();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.tokens).toEqual(tokens);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
  });
});

describe('usePoolId', () => {
  const pools = {
    items: [
      { id: 'pool-30', token0: 'TOKEN_A', token1: 'TOKEN_B', feeTier: 30 },
      { id: 'pool-100', token0: 'TOKEN_A', token1: 'TOKEN_B', feeTier: 100 },
    ],
  };

  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async () => jsonResponse(pools));
  });

  it('returns the first matching pool when no fee tier is requested', async () => {
    const { result } = renderHook(() => usePoolId('TOKEN_A', 'TOKEN_B'));

    await waitFor(() => {
      expect(result.current.poolExists).toBe(true);
    });

    expect(result.current.poolId).toBe('pool-30');
    expect(result.current.feeTier).toBe(30);
  });

  it('selects the pool matching the requested fee tier and re-runs when it changes', async () => {
    const { result, rerender } = renderHook(
      ({ feeTier }: { feeTier: number | null }) => usePoolId('TOKEN_A', 'TOKEN_B', feeTier),
      { initialProps: { feeTier: 100 as number | null } }
    );

    await waitFor(() => {
      expect(result.current.poolId).toBe('pool-100');
    });
    expect(result.current.feeTier).toBe(100);
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);

    rerender({ feeTier: 30 });

    await waitFor(() => {
      expect(result.current.poolId).toBe('pool-30');
    });
    expect(result.current.feeTier).toBe(30);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
  });

  it('matches regardless of token order', async () => {
    const { result } = renderHook(() => usePoolId('TOKEN_B', 'TOKEN_A', 100));

    await waitFor(() => {
      expect(result.current.poolId).toBe('pool-100');
    });
  });

  it('reports no pool when the requested fee tier does not exist for the pair', async () => {
    const { result } = renderHook(() => usePoolId('TOKEN_A', 'TOKEN_B', 500));

    await waitFor(() => {
      expect(result.current.poolExists).toBe(false);
    });

    expect(result.current.poolId).toBeNull();
    expect(result.current.feeTier).toBeNull();
  });
});
