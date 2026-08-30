'use client';

import { useEffect, useRef, useState } from 'react';
import { EMPTY_QUOTE, type SwapQuote } from '@swyft/sdk';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

function getWsBase(): string {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  return `${protocol}://${host}`;
}

const DEBOUNCE_MS = 350;

interface Params {
  poolId: string | null;
  tokenInId: string | null;
  tokenOutId: string | null;
  amountIn: string;
  slippageBps: number;
}

interface FetchQuoteArgs {
  poolId: string;
  tokenInId: string;
  tokenOutId: string;
  amountIn: string;
  slippageBps: number;
  signal?: AbortSignal;
}

/** Calls the API's POST /swaps/quote, backed by real pool depth. */
async function fetchSwapQuote({
  poolId,
  tokenInId,
  tokenOutId,
  amountIn,
  slippageBps,
  signal,
}: FetchQuoteArgs): Promise<SwapQuote> {
  const res = await apiFetch(`${API_BASE}/swaps/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      poolId,
      tokenIn: tokenInId,
      tokenOut: tokenOutId,
      amountIn,
      slippageBps,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch swap quote: ${res.status}`);
  }

  const data = (await res.json()) as {
    amountOut: string;
    priceImpact: number;
    lpFee: string;
    minimumReceived: string;
    executionPrice: string;
  };

  return {
    amountOut: data.amountOut,
    priceImpact: data.priceImpact,
    lpFee: data.lpFee,
    protocolFee: '0',
    minimumReceived: data.minimumReceived,
    executionPrice: data.executionPrice,
  };
}

export function useSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps }: Params) {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  // Recalculate quote whenever inputs change (debounced), sourced from the
  // API's POST /swaps/quote (real pool depth), not local stub math.
  useEffect(() => {
    if (!poolId || !tokenInId || !tokenOutId || !amountIn || parseFloat(amountIn) <= 0) {
      setQuote(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    const currentSequence = ++sequenceRef.current;

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      fetchSwapQuote({
        poolId,
        tokenInId,
        tokenOutId,
        amountIn,
        slippageBps,
        signal: controller.signal,
      })
        .then((result) => {
          if (currentSequence === sequenceRef.current) {
            setQuote(result);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (currentSequence === sequenceRef.current) {
            setQuote(EMPTY_QUOTE);
          }
        })
        .finally(() => {
          if (currentSequence === sequenceRef.current) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [poolId, tokenInId, tokenOutId, amountIn, slippageBps]);

  // WebSocket: re-run quote on live price events for this pool
  useEffect(() => {
    if (!poolId || !tokenInId || !tokenOutId) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let attempts = 0;
    let disposed = false;

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempts++);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;
      try {
        ws = new WebSocket(`${getWsBase()}/price`);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        attempts = 0;
        ws?.send(JSON.stringify({ action: 'subscribe', poolId }));
      };
      ws.onclose = scheduleReconnect;
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as {
            event?: string;
            data?: { poolId?: string };
          };
          if (msg.event !== 'price' || msg.data?.poolId !== poolId) return;
          if (!poolId || !tokenInId || !tokenOutId) return;
          if (!amountIn || parseFloat(amountIn) <= 0) return;

          // Re-fetch from the API on live price events too, so the quote
          // reflects real depth rather than the hardcoded-reserve helper.
          const currentSequence = ++sequenceRef.current;
          fetchSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps })
            .then((result) => {
              if (currentSequence === sequenceRef.current) {
                setQuote(result);
              }
            })
            .catch(() => {
              // Keep the last known-good quote on transient fetch errors.
            });
        } catch {
          // ignore malformed messages
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer ?? undefined);
      ws?.close();
    };
  }, [poolId, tokenInId, tokenOutId, amountIn, slippageBps]);

  return { quote, loading };
}
