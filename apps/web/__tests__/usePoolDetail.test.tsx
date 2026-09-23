import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePoolDetail, type PoolDetail } from '@/hooks/usePoolDetail';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('usePoolDetail', () => {
  const mockPoolDetail: PoolDetail = {
    id: 'pool-123',
    token0: {
      address: 'GBUQWP3BOUZX34ULNQG23RQ6F4PFXPUWX3BNRQNOBJGAZLMUUYJEZGPK',
      symbol: 'XLM',
      name: 'Stellar Lumens',
      decimals: 7,
    },
    token1: {
      address: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZWZYVN5RWSOME4XL',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    feeTier: 30,
    currentSqrtPrice: '1000000',
    currentTick: -22000,
    totalLiquidity: '5000000',
    tvl: '1000000',
    volume24h: '500000',
    volume7d: '3500000',
    feeApr: '12.5',
    creationTimestamp: 1700000000,
    recentSwaps: [],
  };

  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch and return pool data', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockPoolDetail,
    });

    const { result } = renderHook(() => usePoolDetail('pool-123'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockPoolDetail);
    expect(result.current.isError).toBe(false);
  });

  it('should return error on 404', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => usePoolDetail('pool-notfound'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('should not fetch if poolId is null', () => {
    global.fetch = vi.fn();

    const { result } = renderHook(() => usePoolDetail(null), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});

