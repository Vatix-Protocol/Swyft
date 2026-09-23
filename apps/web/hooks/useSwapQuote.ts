'use client';

import { useEffect, useRef, useState } from 'react';
import type { SwapQuote } from '@swyft/sdk';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

/** Derives the WS base from the API host (apps/api, :3001), not the Next.js host. */
function getWsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return apiUrl.replace(/^http/, 'ws');
}

const DEBOUNCE_MS = 350;

interface Params {
  poolId: string | null;
  tokenInId: string | null;
  tokenOutId: string | null;
  amountIn: string;
  slippageBps: number;
}

interface QuoteRequestParams {
  poolId: string;
  tokenInId: string;
  tokenOutId: string;
  amountIn: string;
  slippageBps: number;
}

/** Fetches a real, depth-aware swap quote from POST /v1/swaps/quote. */
async function fetchQuote(
  { poolId, tokenInId, tokenOutId, amountIn, slippageBps }: QuoteRequestParams,
  signal?: AbortSignal
): Promise<SwapQuote | null> {
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
  if (!res.ok) return null;
  const data = (await res.json()) as Omit<SwapQuote, 'protocolFee'>;
  return { ...data, protocolFee: '0' };
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
      fetchQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps }, controller.signal)
        .then((result) => {
          if (currentSequence === sequenceRef.current) {
            setQuote(result);
          }
        })
        .catch(() => {
          if (currentSequence === sequenceRef.current) {
            setQuote(null);
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
          fetchQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps })
            .then((result) => setQuote(result))
            .catch(() => setQuote(null));
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
