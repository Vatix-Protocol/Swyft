import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useSwapQuote } from './useSwapQuote';

class MockWebSocket {
  send = vi.fn();
  close = vi.fn();
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
}

const baseParams = {
  poolId: 'CPOOL',
  tokenInId: 'CUSDC',
  tokenOutId: 'CXLM',
  amountIn: '100',
  slippageBps: 50,
};

describe('useSwapQuote slippage refetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ amountOut: '95' }) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches once on first render and again when only slippageBps changes', async () => {
    const { rerender } = renderHook((props) => useSwapQuote(props), {
      initialProps: baseParams,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    rerender({ ...baseParams });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    rerender({ ...baseParams, slippageBps: 100 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(mockApiFetch.mock.calls[1][1].body as string);
    expect(body.slippageBps).toBe(100);
  });
});
