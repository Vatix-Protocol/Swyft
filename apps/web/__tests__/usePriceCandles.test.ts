import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePriceCandles } from '@/hooks/usePriceCandles';

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

const mockWebSocketSend = vi.fn();
const mockWebSocketClose = vi.fn();

global.WebSocket = vi.fn(() => ({
  send: mockWebSocketSend,
  close: mockWebSocketClose,
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
})) as any;

// ─── Mock fetch ───────────────────────────────────────────────────────────────

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ candles: [] }),
  } as Response)
);

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

describe('usePriceCandles — WebSocket protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses wss:// protocol when page is https', async () => {
    setProtocol('https:');

    renderHook(() => usePriceCandles('token-a', 'token-b', '1h'));

    // Give it a moment for the WebSocket to be created
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('wss://')
    );
  });

  it('uses ws:// protocol when page is http', async () => {
    setProtocol('http:');

    renderHook(() => usePriceCandles('token-a', 'token-b', '1h'));

    // Give it a moment for the WebSocket to be created
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('ws://')
    );
  });

  it('uses NEXT_PUBLIC_WS_URL when environment variable is set', async () => {
    process.env.NEXT_PUBLIC_WS_URL = 'wss://custom-candles.example.com';

    renderHook(() => usePriceCandles('token-a', 'token-b', '1d'));

    // Give it a moment for the WebSocket to be created
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('custom-candles.example.com')
    );

    delete process.env.NEXT_PUBLIC_WS_URL;
  });

  it('cancels reconnect timer on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const { unmount } = renderHook(() => usePriceCandles('token-a', 'token-b', '1h'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(mockWebSocketClose).toHaveBeenCalled();
  });

  it('closes WebSocket on unmount', async () => {
    const { unmount } = renderHook(() => usePriceCandles('token-a', 'token-b', '5m'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    unmount();

    expect(mockWebSocketClose).toHaveBeenCalled();
  });

  it('handles malformed WebSocket messages without throwing', async () => {
    renderHook(() => usePriceCandles('token-a', 'token-b', '1h'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const mockWs = (global.WebSocket as any).mock.results[0].value;

    expect(() => {
      mockWs.onmessage({ data: 'invalid json' });
    }).not.toThrow();

    expect(() => {
      mockWs.onmessage({ data: JSON.stringify({ invalid: 'message' }) });
    }).not.toThrow();
  });
});
