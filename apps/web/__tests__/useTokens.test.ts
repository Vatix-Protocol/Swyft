import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTokens } from '../hooks/useTokens';
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
