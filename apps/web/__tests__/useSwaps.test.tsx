import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSwaps } from '@/hooks/useSwaps';
import { apiFetch } from '@/lib/api-fetch';
import { API_BASE } from '@/lib/constants';

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

const WALLET = 'GBUQWP3BOUZX34ULNQG23RQ6F4PFXPUWX3BNRQNOBJGAZLMUUYJEZGPK';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSwaps', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('requests the swaps list with the wallet, page and limit params the API accepts', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));

    const { result } = renderHook(() => useSwaps(WALLET, 3, 10), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=3&limit=10`
    );
  });

  it('parses the API response into SwapSnapshot items', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: 'swap-1',
            poolId: 'pool-1',
            tokenPair: 'XLM/USDC',
            token0Symbol: 'XLM',
            token1Symbol: 'USDC',
            amount0: '100',
            amount1: '-12.5',
            priceAtSwap: '0.125',
            feeAmount: '0.3',
            route: ['pool-1', 'pool-2'],
            transactionHash: 'abc123',
            walletAddress: WALLET,
            timestamp: 1_700_000_000,
          },
          {
            id: 'swap-2',
            poolId: 'pool-1',
            tokenPair: 'XLM/USDC',
            token0Symbol: 'XLM',
            token1Symbol: 'USDC',
            amount0: '-50',
            amount1: '6',
            priceAtSwap: '0.12',
            feeAmount: '0.15',
            transactionHash: 'def456',
            walletAddress: WALLET,
            timestamp: 1_700_000_100,
          },
        ],
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        isLoading: false,
      })
    );

    const { result } = renderHook(() => useSwaps(WALLET), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=1&limit=20`
    );
    expect(result.current.data).toEqual({
      items: [
        {
          id: 'swap-1',
          poolId: 'pool-1',
          token0Symbol: 'XLM',
          token1Symbol: 'USDC',
          amount0: '100',
          amount1: '-12.5',
          priceAtSwap: '0.125',
          route: ['pool-1', 'pool-2'],
          txHash: 'abc123',
          walletAddress: WALLET,
          timestamp: 1_700_000_000,
        },
        {
          id: 'swap-2',
          poolId: 'pool-1',
          token0Symbol: 'XLM',
          token1Symbol: 'USDC',
          amount0: '-50',
          amount1: '6',
          priceAtSwap: '0.12',
          txHash: 'def456',
          walletAddress: WALLET,
          timestamp: 1_700_000_100,
        },
      ],
      total: 2,
    });
    expect(result.current.data?.items[0]).not.toHaveProperty('routeLeg');
  });

  it('does not call the API without a wallet address', () => {
    const { result } = renderHook(() => useSwaps(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
