import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_BASE } from '@/lib/constants';
import type { SwapsApiResponse } from '@/hooks/useSwaps';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useSwaps } from '@/hooks/useSwaps';

const WALLET = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const apiBody: SwapsApiResponse = {
  items: [
    {
      id: 'swap-1',
      poolId: 'pool-xlm-usdc',
      tokenPair: 'XLM/USDC',
      token0Symbol: 'XLM',
      token1Symbol: 'USDC',
      amount0: '100',
      amount1: '-10.5',
      priceAtSwap: '0.105',
      feeAmount: '0.3',
      route: ['pool-xlm-usdc', 'pool-usdc-eurc'],
      transactionHash: 'abc123',
      walletAddress: WALLET,
      timestamp: 1700000000,
    },
    {
      id: 'swap-2',
      poolId: 'pool-xlm-usdc',
      tokenPair: 'XLM/USDC',
      token0Symbol: 'XLM',
      token1Symbol: 'USDC',
      amount0: '-50',
      amount1: '5',
      priceAtSwap: '0.1',
      feeAmount: '0.15',
      transactionHash: 'def456',
      walletAddress: WALLET,
      timestamp: 1700000100,
    },
  ],
  page: 2,
  limit: 5,
  total: 7,
  totalPages: 2,
};

describe('useSwaps', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockApiFetch.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  it('requests GET /swaps with the wallet, page and limit params accepted by the API', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => apiBody });

    const { result } = renderHook(() => useSwaps(WALLET, 2, 5), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=2&limit=5`,
    );
  });

  it('parses the API response into SwapSnapshot items', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => apiBody });

    const { result } = renderHook(() => useSwaps(WALLET, 2, 5), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toStrictEqual({
      items: [
        {
          id: 'swap-1',
          poolId: 'pool-xlm-usdc',
          token0Symbol: 'XLM',
          token1Symbol: 'USDC',
          amount0: '100',
          amount1: '-10.5',
          priceAtSwap: '0.105',
          route: ['pool-xlm-usdc', 'pool-usdc-eurc'],
          txHash: 'abc123',
          walletAddress: WALLET,
          timestamp: 1700000000,
        },
        {
          id: 'swap-2',
          poolId: 'pool-xlm-usdc',
          token0Symbol: 'XLM',
          token1Symbol: 'USDC',
          amount0: '-50',
          amount1: '5',
          priceAtSwap: '0.1',
          txHash: 'def456',
          walletAddress: WALLET,
          timestamp: 1700000100,
        },
      ],
      total: 7,
    });
    expect(result.current.data?.items[0]).not.toHaveProperty('routeLeg');
  });

  it('does not request swaps when no wallet is connected', () => {
    renderHook(() => useSwaps(null, 1, 20), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('surfaces a non-OK response as an error', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useSwaps(WALLET), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=1&limit=20`,
    );
    expect(result.current.error?.message).toBe('Failed to fetch swaps');
  });
});
