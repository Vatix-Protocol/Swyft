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
    mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => apiBody });

    const { result } = renderHook(() => useSwaps(WALLET, 2, 5), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=2&limit=5`
    );

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
