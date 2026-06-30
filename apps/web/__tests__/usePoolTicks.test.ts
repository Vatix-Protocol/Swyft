import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePools } from '@/hooks/usePoolTicks';

const mockPools = [
  {
    id: 'pool-xlm-usdc-030',
    token0: 'XLM',
    token1: 'USDC',
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    feeTier: '0.30%',
    currentPrice: 0.1085,
    currentTick: -22000,
    tvl: 4_200_000,
    feeApr: 12.4,
    volume24h: 340_000,
  },
];

describe('usePools', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows initial loading state then returns pool data', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: mockPools }),
    });

    const { result } = renderHook(() => usePools());

    expect(result.current.loading).toBe(true);
    expect(result.current.pools).toHaveLength(0);
    expect(result.current.isStale).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pools).toEqual(mockPools);
    expect(result.current.error).toBeNull();
    expect(result.current.isStale).toBe(false);
  });

  it('handles fetch failure gracefully with mock data and error', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => usePools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.pools).toHaveLength(3);
    expect(result.current.isStale).toBe(true);
  });

  it('handles HTTP error gracefully with mock data and error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => usePools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain('500');
    expect(result.current.pools).toHaveLength(3);
  });

  it('handles invalid JSON response gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error('Invalid JSON'); },
    });

    const { result } = renderHook(() => usePools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.pools).toHaveLength(3);
  });

  it('handles null response body gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => null,
    });

    const { result } = renderHook(() => usePools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.pools).toHaveLength(3);
    expect(result.current.isStale).toBe(true);
  });

  it('handles empty items array response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const { result } = renderHook(() => usePools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pools).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isStale).toBe(false);
  });

  it('cancels state updates on unmount', async () => {
    let resolveFetch: () => void;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({ ok: true, json: async () => ({ items: mockPools }) });
        })
    );

    const { result, unmount } = renderHook(() => usePools());

    expect(result.current.loading).toBe(true);

    unmount();

    resolveFetch!();

    await waitFor(() => {
      expect(result.current.pools).toHaveLength(0);
    });
  });
});