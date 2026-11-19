import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('@/lib/api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { useSwapQuote } from '@/hooks/useSwapQuote';

global.WebSocket = vi.fn(() => ({ send: vi.fn(), close: vi.fn() })) as unknown as typeof WebSocket;

type Props = { tokenInId: string | null; tokenOutId: string | null; amountIn: string };

describe('useSwapQuote — token selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not request a quote until both tokens and an amount are set', async () => {
    const { rerender } = renderHook(
      ({ tokenInId, tokenOutId, amountIn }: Props) =>
        useSwapQuote({ poolId: 'pool-1', tokenInId, tokenOutId, amountIn, slippageBps: 50 }),
      { initialProps: { tokenInId: null, tokenOutId: null, amountIn: '' } as Props }
    );

    const steps: Props[] = [
      { tokenInId: 'token-a', tokenOutId: null, amountIn: '' },
      { tokenInId: 'token-a', tokenOutId: null, amountIn: '10' },
      { tokenInId: null, tokenOutId: 'token-b', amountIn: '10' },
      { tokenInId: 'token-a', tokenOutId: 'token-b', amountIn: '' },
    ];
    for (const props of steps) {
      rerender(props);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(apiFetch).toHaveBeenCalledTimes(0);
    }

    rerender({ tokenInId: 'token-a', tokenOutId: 'token-b', amountIn: '10' });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
