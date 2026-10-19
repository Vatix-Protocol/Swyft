import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSwaps, type SwapSnapshot } from '@/hooks/useSwaps';
import { apiFetch } from '@/lib/api-fetch';
import { API_BASE } from '@/lib/constants';

/**
 * Pins the web side of the `GET /swaps` contract: the filter param accepted by
 * GetSwapsQueryDto (`wallet`) and the item shape returned by the API's
 * SwapsService.toResponse (`transactionHash`, a single `route` field).
 */

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

// Matches GetSwapsQueryDto's address pattern /^G[A-Z2-7]{55}$/.
const WALLET = `G${'A'.repeat(55)}`;

/** Item exactly as the API serializes it (see SwapsService.toResponse). */
const apiItem = {
  id: 'swap-1',
  poolId: 'pool-1',
  tokenPair: 'XLM/USDC',
  token0Symbol: 'XLM',
  token1Symbol: 'USDC',
  amount0: '100',
  amount1: '-10',
  priceAtSwap: '0.1',
  feeAmount: '0.3',
  route: ['pool-1', 'pool-2'],
  transactionHash: 'tx-hash-1',
  walletAddress: WALLET,
  timestamp: 1_700_000_000_000,
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function renderUseSwaps(wallet: string | null, page?: number, limit?: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSwaps(wallet, page, limit), { wrapper });
}

describe('useSwaps', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('requests the exact swaps URL for a given wallet, page and limit', async () => {
    mockedApiFetch.mockResolvedValue(
      jsonResponse({ items: [], page: 2, limit: 10, total: 0, totalPages: 0, isLoading: false }),
    );

    const { result } = renderUseSwaps(WALLET, 2, 10);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=2&limit=10`,
    );
  });

  it('defaults to page 1 and limit 20', async () => {
    mockedApiFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));

    const { result } = renderUseSwaps(WALLET);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `${API_BASE}/swaps?wallet=${WALLET}&page=1&limit=20`,
    );
  });

  it('parses the API list response into SwapSnapshot fields', async () => {
    mockedApiFetch.mockResolvedValue(
      jsonResponse({
        items: [apiItem],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        isLoading: false,
      }),
    );

    const { result } = renderUseSwaps(WALLET);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    const swap: SwapSnapshot = result.current.data!.items[0];
    expect(swap).toEqual(apiItem);
    expect(swap.transactionHash).toBe('tx-hash-1');
    expect(swap.route).toEqual(['pool-1', 'pool-2']);
    expect(swap).not.toHaveProperty('routeLeg');
    expect(swap).not.toHaveProperty('txHash');
  });

  it('does not call the API without a wallet', () => {
    const { result } = renderUseSwaps(null);

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
