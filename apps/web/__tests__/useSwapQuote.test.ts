import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSwapQuote } from '@/hooks/useSwapQuote';

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

const mockWebSocketSend = vi.fn();
const mockWebSocketClose = vi.fn();
let mockWebSocketInstance: any;

global.WebSocket = vi.fn(() => ({
  send: mockWebSocketSend,
  close: mockWebSocketClose,
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
})) as any;

// ─── Mock window.location ─────────────────────────────────────────────────────

const originalLocation = window.location;
delete (window as any).location;

function setProtocol(protocol: 'http:' | 'https:') {
  (window as any).location = {
    protocol,
    host: 'example.com',
  };
}

afterEach(() => {
  (window as any).location = originalLocation;
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useSwapQuote — WebSocket protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses wss:// protocol when page is https', () => {
    setProtocol('https:');

    renderHook(() =>
      useSwapQuote({
        poolId: 'pool-1',
        tokenInId: 'token-1',
        tokenOutId: 'token-2',
        amountIn: '100',
        slippageBps: 50,
      })
    );

    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('wss://')
    );
  });

  it('uses ws:// protocol when page is http', () => {
    setProtocol('http:');

    renderHook(() =>
      useSwapQuote({
        poolId: 'pool-1',
        tokenInId: 'token-1',
        tokenOutId: 'token-2',
        amountIn: '100',
        slippageBps: 50,
      })
    );

    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('ws://')
    );
  });

  it('uses NEXT_PUBLIC_WS_URL when environment variable is set', () => {
    process.env.NEXT_PUBLIC_WS_URL = 'wss://custom-ws.example.com';

    renderHook(() =>
      useSwapQuote({
        poolId: 'pool-1',
        tokenInId: 'token-1',
        tokenOutId: 'token-2',
        amountIn: '100',
        slippageBps: 50,
      })
    );

    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('custom-ws.example.com')
    );

    delete process.env.NEXT_PUBLIC_WS_URL;
  });

  it('cancels reconnect timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const { unmount } = renderHook(() =>
      useSwapQuote({
        poolId: 'pool-1',
        tokenInId: 'token-1',
        tokenOutId: 'token-2',
        amountIn: '100',
        slippageBps: 50,
      })
    );

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(mockWebSocketClose).toHaveBeenCalled();
  });

  it('closes WebSocket on unmount', () => {
    const { unmount } = renderHook(() =>
      useSwapQuote({
        poolId: 'pool-1',
        tokenInId: 'token-1',
        tokenOutId: 'token-2',
        amountIn: '100',
        slippageBps: 50,
      })
    );

    unmount();

    expect(mockWebSocketClose).toHaveBeenCalled();
  });

  it('handles malformed WebSocket messages without throwing', () => {
    const { result } = renderHook(() =>
      useSwapQuote({
        poolId: 'pool-1',
        tokenInId: 'token-1',
        tokenOutId: 'token-2',
        amountIn: '100',
        slippageBps: 50,
      })
    );

    const mockWs = (global.WebSocket as any).mock.results[0].value;

    expect(() => {
      mockWs.onmessage({ data: 'invalid json' });
    }).not.toThrow();

    expect(() => {
      mockWs.onmessage({ data: JSON.stringify({ invalid: 'message' }) });
    }).not.toThrow();
  });
});
