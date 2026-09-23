import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { TransactionStatusProvider, useTransactionStatus } from '@/context/TransactionStatusContext';

function useHarness(address: string | null, tokenIds: string[]) {
  const balances = useWalletBalances(address, tokenIds);
  const { reportTx } = useTransactionStatus();
  return { balances, reportTx };
}

describe('useWalletBalances', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    sessionStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TransactionStatusProvider>{children}</TransactionStatusProvider>
      </QueryClientProvider>
    );
  }

  it('fetches balances for a connected address', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'token-a': '100', 'token-b': '50' }),
    });

    const { result } = renderHook(() => useHarness('wallet-1', ['token-a', 'token-b']), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.balances).toEqual({ 'token-a': '100', 'token-b': '50' });
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('requests GET /balances with the URL-encoded wallet address', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    global.fetch = fetchMock;

    renderHook(() => useHarness('G-wallet address/with?odd chars', ['token-a']), {
      wrapper,
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [requestedUrl] = fetchMock.mock.calls[0];
    expect(requestedUrl).toContain('/balances?address=');
    expect(requestedUrl).toContain(encodeURIComponent('G-wallet address/with?odd chars'));
  });

  it('does not fetch when there is no address', () => {
    global.fetch = vi.fn();

    const { result } = renderHook(() => useHarness(null, ['token-a']), { wrapper });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.balances).toEqual({});
  });

  it('refetches balances after a swap reports success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ 'token-a': '100' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ 'token-a': '120' }) });
    global.fetch = fetchMock;

    const { result } = renderHook(() => useHarness('wallet-1', ['token-a']), { wrapper });

    await waitFor(() => expect(result.current.balances).toEqual({ 'token-a': '100' }));

    act(() => {
      result.current.reportTx({ label: 'Swap', status: 'success', txHash: 'tx-1' });
    });

    await waitFor(() => expect(result.current.balances).toEqual({ 'token-a': '120' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refetch again for a repeat success report of the same tx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ 'token-a': '100' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ 'token-a': '120' }) });
    global.fetch = fetchMock;

    const { result, rerender } = renderHook(() => useHarness('wallet-1', ['token-a']), {
      wrapper,
    });

    await waitFor(() => expect(result.current.balances).toEqual({ 'token-a': '100' }));

    act(() => {
      result.current.reportTx({ label: 'Swap', status: 'success', txHash: 'tx-1' });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    rerender();
    act(() => {
      result.current.reportTx({ label: 'Swap', status: 'success', txHash: 'tx-1' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
