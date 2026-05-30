import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMathLib } from '@/hooks/useMathLib';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@swyft/sdk', () => ({
  SwyftRpcError: class SwyftRpcError extends Error {},
}));

vi.mock('@/lib/constants', () => ({
  API_BASE: 'http://localhost:3001',
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeErrorResponse(status: number) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMathLib — loading state', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── sqrtPriceToTick ───────────────────────────────────────────────────────

  describe('sqrtPriceToTick()', () => {
    it('isLoading is false before any call', () => {
      const { result } = renderHook(() => useMathLib());
      expect(result.current.isLoading).toBe(false);
    });

    it('isLoading becomes true while the request is in flight', async () => {
      let resolveFetch!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => { resolveFetch = resolve; }),
      );

      const { result } = renderHook(() => useMathLib());

      // Start the call but do not await it yet
      act(() => { void result.current.sqrtPriceToTick('79228162514264337593543950336'); });

      expect(result.current.isLoading).toBe(true);

      // Resolve the fetch and wait for state to settle
      await act(async () => {
        resolveFetch({ ok: true, json: async () => ({ tick: 0 }) } as Response);
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('isLoading returns to false after a successful response', async () => {
      mockFetch.mockReturnValueOnce(makeOkResponse({ tick: 42 }));

      const { result } = renderHook(() => useMathLib());

      await act(async () => {
        await result.current.sqrtPriceToTick('79228162514264337593543950336');
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.result?.tick).toBe(42);
    });

    it('isLoading returns to false after a failed response', async () => {
      mockFetch.mockReturnValueOnce(makeErrorResponse(500));

      const { result } = renderHook(() => useMathLib());

      await act(async () => {
        await result.current.sqrtPriceToTick('0');
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.result?.error).toBeDefined();
    });

    it('returns null and sets error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useMathLib());

      let tick: number | null = -1;
      await act(async () => {
        tick = await result.current.sqrtPriceToTick('0');
      });

      expect(tick).toBeNull();
      expect(result.current.result?.error).toBe('Network error');
      expect(result.current.isLoading).toBe(false);
    });
  });

  // ── tickToSqrtPrice ───────────────────────────────────────────────────────

  describe('tickToSqrtPrice()', () => {
    it('isLoading is false before any call', () => {
      const { result } = renderHook(() => useMathLib());
      expect(result.current.isLoading).toBe(false);
    });

    it('isLoading becomes true while the request is in flight', async () => {
      let resolveFetch!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => { resolveFetch = resolve; }),
      );

      const { result } = renderHook(() => useMathLib());

      act(() => { void result.current.tickToSqrtPrice(0); });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({ sqrtPriceX96: '79228162514264337593543950336' }),
        } as Response);
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('isLoading returns to false after a successful response', async () => {
      const sqrtPrice = '79228162514264337593543950336';
      mockFetch.mockReturnValueOnce(makeOkResponse({ sqrtPriceX96: sqrtPrice }));

      const { result } = renderHook(() => useMathLib());

      await act(async () => {
        await result.current.tickToSqrtPrice(0);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.result?.sqrtPrice).toBe(sqrtPrice);
    });

    it('isLoading returns to false after a failed response', async () => {
      mockFetch.mockReturnValueOnce(makeErrorResponse(400));

      const { result } = renderHook(() => useMathLib());

      await act(async () => {
        await result.current.tickToSqrtPrice(999999);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.result?.error).toBeDefined();
    });

    it('disabled actions: returns null on error so callers can gate on it', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const { result } = renderHook(() => useMathLib());

      let sqrtPrice: string | null = 'initial';
      await act(async () => {
        sqrtPrice = await result.current.tickToSqrtPrice(0);
      });

      // Callers should disable submit actions when the return value is null
      expect(sqrtPrice).toBeNull();
    });
  });
});
