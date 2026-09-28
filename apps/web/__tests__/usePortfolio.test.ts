import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

vi.mock('@/context/NetworkContext', () => ({
  useNetworkContext: () => ({ apiBase: 'https://mainnet-api.example/v1' }),
}));

function position(id: string, status: 'active' | 'closed') {
  return {
    id,
    status,
    ownerWallet: 'GOWNER',
    poolId: 'CPOOL',
    tokenId: id,
    tokenPair: { token0: 'USDC', token1: 'XLM' },
    lowerTick: -100,
    upperTick: 100,
    liquidity: '1000',
    currentValueUsd: 5,
    uncollectedFeesToken0: '0.1',
    uncollectedFeesToken1: '0.2',
    createdAt: 1_700_000_000,
    closedAt: status === 'closed' ? 1_700_100_000 : null,
    poolCurrentPrice: 1,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePortfolio', () => {
  it('loads indexed chain positions from the selected network API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [position('active-1', 'active'), position('closed-1', 'closed')],
        total: 2,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePortfolio('wallet-token'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mainnet-api.example/v1/positions?status=all&page=1&limit=50',
      expect.objectContaining({
        headers: { Authorization: expect.any(String) },
      }),
    );
    expect(result.current.active.map(({ id }) => id)).toEqual(['active-1']);
    expect(result.current.closed.map(({ id }) => id)).toEqual(['closed-1']);
    expect(result.current.active[0]).toMatchObject({
      tokenId: 'active-1',
      token0: 'USDC',
      token1: 'XLM',
      poolCurrentPrice: 1,
    });
    expect(result.current.error).toBeNull();
  });

  it('loads every page instead of silently truncating large portfolios', async () => {
    const items = Array.from({ length: 50 }, (_, index) => position(`pos-${index}`, 'active'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items, total: 51 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [position('pos-50', 'active')], total: 51 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePortfolio('wallet-token'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('page=2');
    expect(result.current.active).toHaveLength(51);
  });

  it('surfaces API failures instead of presenting an empty portfolio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const { result } = renderHook(() => usePortfolio('wallet-token'));

    await waitFor(() => expect(result.current.error).toContain('503'));
    expect(result.current.active).toEqual([]);
  });
});
