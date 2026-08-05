'use client';

import { useEffect, useRef, useState } from 'react';
import { calculateSwapQuote, type SwapQuote } from '@swyft/sdk';
import { API_BASE } from '@/lib/constants';

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

export function useSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps }: Params) {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  // Recalculate quote whenever inputs change (debounced)
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
      const result = calculateSwapQuote({ poolId, tokenInId, tokenOutId, amountIn, slippageBps });
      if (currentSequence === sequenceRef.current) {
        setQuote(result);
      }
      setLoading(false);
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
          const result = calculateSwapQuote({
            poolId,
            tokenInId,
            tokenOutId,
            amountIn,
            slippageBps,
          });
          setQuote(result);
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
