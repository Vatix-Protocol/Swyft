"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "@/lib/constants";

export type Interval = "1m" | "5m" | "1h" | "1d";

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function getWsBase(): string {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  return `${protocol}://${host}`;
}

export function usePriceCandles(
  tokenA: string | null,
  tokenB: string | null,
  interval: Interval
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [poolId, setPoolId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetch168 = useCallback(async () => {
    if (!tokenA || !tokenB) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/prices/${tokenA}/${tokenB}/candles?interval=${interval}&limit=168`
      );
      if (!res.ok) { setCandles([]); return; }
      const data = (await res.json()) as CandlesResponse;
      const validCandles = (data.data ?? [])
        .filter(isValidCandle)
        .map(mapPriceCandleToCandle);
      setCandles(validCandles);
    } catch {
      setCandles([]);
      setPoolId(null);
    } finally {
      setLoading(false);
    }
  }, [tokenA, tokenB, interval]);

  // Initial fetch
  useEffect(() => {
    setCandles([]);
    setPoolId(null);
    fetch168();
  }, [fetch168]);

  // WebSocket for live candle updates
  useEffect(() => {
    if (!poolId) return;
    wsRef.current?.close();

    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout | null = null;
    try {
      ws = new WebSocket(`${getWsBase()}/price`);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "subscribe", poolId }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.event === "price" && msg.data?.poolId === poolId) {
          setCandles((prev) => {
            if (prev.length === 0) return [msg.data as Candle];
            const last = prev[prev.length - 1];
            if (last.time === (msg.data as Candle).time) {
              return [...prev.slice(0, -1), msg.data as Candle];
            }
            return [...prev.slice(-167), msg.data as Candle];
          });
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws.close();
    };
  }, [tokenA, tokenB, interval]);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  return { candles, loading, currentPrice };
}
