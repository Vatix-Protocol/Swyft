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
  /** True when this candle was synthetically inserted to fill a gap (see CANDLE_GAP_POLICY.md). */
  gap?: boolean;
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

// ── Interval step sizes (seconds) ────────────────────────────────────────────

const INTERVAL_STEP: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '1h': 3_600,
  '1d': 86_400,
};

// ── Gap-fill flag ─────────────────────────────────────────────────────────────
// Set NEXT_PUBLIC_CANDLE_GAP_FILL=false to disable gap-filling (see CANDLE_GAP_POLICY.md).

const GAP_FILL_ENABLED = process.env.NEXT_PUBLIC_CANDLE_GAP_FILL !== 'false';

// ── Type guards & mappers ─────────────────────────────────────────────────────

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

// ── Gap-fill helpers (Rule 1–5 from docs/CANDLE_GAP_POLICY.md) ───────────────

/**
 * Returns true when a candle's timestamp is valid for inclusion.
 * Drops NaN, Infinity, and future candles (Rule 2).
 */
function isValidCandleTime(time: number, nowSecs: number, stepSecs: number): boolean {
  return (
    Number.isFinite(time) &&
    time > 0 &&
    time <= nowSecs + stepSecs // allow at most one step into the future (live tick)
  );
}

/**
 * Sorts candles ascending by time, deduplicates (keeps last seen per time),
 * and drops malformed timestamps (Rule 2 + 3).
 */
function sanitize(candles: Candle[], interval: Interval): Candle[] {
  const nowSecs = Math.floor(Date.now() / 1_000);
  const step = INTERVAL_STEP[interval];

  const seen = new Map<number, Candle>();
  for (const c of candles) {
    if (!isValidCandleTime(c.time, nowSecs, step)) continue;
    seen.set(c.time, c); // last-write-wins dedup
  }

  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

/**
 * Inserts synthetic gap candles for every missing interval step (Rule 1).
 * Gap candles carry `gap: true` and zero volume.
 */
function fillGaps(candles: Candle[], interval: Interval): Candle[] {
  if (!GAP_FILL_ENABLED || candles.length < 2) return candles;

  const step = INTERVAL_STEP[interval];
  const result: Candle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    result.push(current);

    if (i < candles.length - 1) {
      const next = candles[i + 1];
      const expectedNext = current.time + step;

      // Insert gap candles for every missing step between current and next.
      let t = expectedNext;
      while (t < next.time) {
        result.push({
          time: t,
          open: current.close,
          high: current.close,
          low: current.close,
          close: current.close,
          volume: 0,
          gap: true,
        });
        t += step;
      }
    }
  }

  return result;
}

/**
 * Merges a live WebSocket candle into the existing series, maintaining gap
 * policy for the live path (Rule 4).
 */
function mergeLiveCandle(prev: Candle[], incoming: Candle, interval: Interval): Candle[] {
  if (prev.length === 0) return [incoming];

  const step = INTERVAL_STEP[interval];
  const last = prev[prev.length - 1];

  // Stale delivery — ignore (Rule 4).
  if (incoming.time < last.time) return prev;

  // Tick update — replace last candle (Rule 4).
  if (incoming.time === last.time) {
    return [...prev.slice(0, -1), incoming];
  }

  // One step ahead — append (optionally with gaps) (Rule 4).
  const withGap = fillGaps([...prev, incoming], interval);
  // Trim to 168 real candles (Rule 5: gaps don't count toward the 168 limit).
  const realCandles = withGap.filter((c) => !c.gap);
  if (realCandles.length <= 168) return withGap;

  // Drop oldest real candle and rebuild.
  const trimmedReal = realCandles.slice(-168);
  return fillGaps(trimmedReal, interval);
}

// ── WebSocket base URL helper ─────────────────────────────────────────────────

/** Derives the WS base from the API host (apps/api, :3001), not the Next.js host. */
function getWsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return apiUrl.replace(/^http/, 'ws');
}

// ── Hook ─────────────────────────────────────────────────────────────────────

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
      const mapped = rawCandles.filter(isApiCandle).map(mapApiCandleToCandle);
      const sanitized = sanitize(mapped, interval);
      const filled = fillGaps(sanitized, interval);
      setCandles(filled);
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
            const incoming = msg.data as Candle;
            setCandles((prev) => mergeLiveCandle(prev, incoming, interval));
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

  // Derive current price from the last *real* (non-gap) candle.
  const lastRealCandle = [...candles].reverse().find((c) => !c.gap) ?? null;
  const currentPrice = lastRealCandle ? lastRealCandle.close : null;

  return { candles, loading, currentPrice, poolId };
}
