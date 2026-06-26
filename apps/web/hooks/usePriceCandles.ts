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

const WS_BASE = API_BASE.replace(/^http/, "ws");

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
      if (!res.ok) { setCandles([]); setPoolId(null); return; }
      const data = (await res.json()) as { poolId?: string; candles?: Candle[] };
      setCandles(data.candles ?? []);
      setPoolId(data.poolId ?? null);
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
    try {
      ws = new WebSocket(`${WS_BASE}/price`);
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

    return () => { ws.close(); };
  }, [poolId]);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  return { candles, loading, currentPrice };
}
