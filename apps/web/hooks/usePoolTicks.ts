'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

export interface TickData {
  tick: number;
  liquidityNet: string;
  liquidityGross: string;
}

export interface PoolDetail {
  id: string;
  token0: string;
  token1: string;
  token0Symbol?: string;
  token1Symbol?: string;
  feeTier: string;
  currentPrice: number;
  currentTick: number;
  sqrtPrice?: string;
  liquidity?: string;
  tvl: number;
  feeApr: number;
  volume24h: number;
}

/**
 * Loads initialized ticks for a pool from the API.
 *
 * Failure policy: if the tick fetch fails (network error, non-2xx
 * response, or bad JSON), `ticks` is cleared and `error` is set so callers
 * can render an explicit error state instead of fabricated liquidity data.
 * Callers can retry via the returned `retry()` function.
 */
export function usePoolTicks(poolId: string | null) {
  const [ticks, setTicks] = useState<TickData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!poolId) {
      setTicks([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    apiFetch(`${API_BASE}/pools/${poolId}/ticks`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load tick data: HTTP ${r.status}`);
        return r.json() as Promise<TickData[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setTicks(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTicks([]);
          setError(err instanceof Error ? err.message : 'Failed to load tick data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolId, retryCount]);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  return { ticks, loading, error, retry };
}

export function usePools() {
  const [pools, setPools] = useState<PoolDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch(`${API_BASE}/pools?limit=50&orderBy=tvl`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load pools: HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (!cancelled) {
          if (!data || typeof data !== 'object') {
            throw new Error('Invalid response format');
          }
          setPools(((data as { items?: PoolDetail[] }).items ?? []));
          setLastUpdated(Date.now());
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error('Failed to load pools');
          setError(error);
          setPools([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isStale = lastUpdated === null;

  return { pools, loading, error, isStale };
}

