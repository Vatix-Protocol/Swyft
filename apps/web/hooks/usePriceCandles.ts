'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

export type Interval = '1m' | '5m' | '1h' | '1d';

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ApiCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface CandlesApiResponse {
  poolId?: string;
  candles: ApiCandle[];
}

function isApiCandle(v: unknown): v is ApiCandle {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.timestamp === 'number';
}

function mapApiCandleToCandle(c: ApiCandle): Candle {
  return {
    time: c.timestamp,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  };
}

function getWsBase(): string {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  return `${protocol}://${host}`;
}

export function usePriceCandles(tokenA: string | null, tokenB: string | null, interval: Interval) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [poolId, setPoolId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetch168 = useCallback(async () => {
    if (!tokenA || !tokenB) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `${API_BASE}/prices/${tokenA}/${tokenB}/candles?interval=${interval}&limit=168`
      );
      if (!res.ok) {
        setCandles([]);
        return;
      }
      const data = (await res.json()) as CandlesApiResponse;
      const rawCandles = Array.isArray(data.candles) ? data.candles : [];
      const validCandles = rawCandles.filter(isApiCandle).map(mapApiCandleToCandle);
      setCandles(validCandles);
      if (data.poolId) {
        setPoolId(data.poolId);
      }
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

  // WebSocket for live candle updates — connect whenever we have a valid token pair
  useEffect(() => {
    if (!tokenA || !tokenB) return;

    wsRef.current?.close();

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
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        if (poolId) {
          ws?.send(JSON.stringify({ action: 'subscribe', poolId }));
        }
      };
      ws.onclose = scheduleReconnect;
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg.event === 'price' && msg.data?.poolId === poolId) {
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
  }, [tokenA, tokenB, interval, poolId]);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  return { candles, loading, currentPrice, poolId };
}
