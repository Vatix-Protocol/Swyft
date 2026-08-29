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
 * Partial data policy: if the tick fetch fails (network error, non-2xx
 * response, or bad JSON), `ticks` falls back to synthetic placeholder
 * liquidity so range-selector charts always have bars to render instead of
 * going blank. `error` is set in this case so callers can flag the chart as
 * showing estimated (not real) liquidity and offer a way to retry via the
 * returned `retry()` function. A successful retry clears `error` and
 * replaces the synthetic ticks with real data.
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
          setTicks(generateSyntheticTicks());
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
          setPools(MOCK_POOLS);
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

function generateSyntheticTicks(): TickData[] {
  const ticks: TickData[] = [];
  const center = 0;
  const spread = 2000;
  const count = 80;

  for (let i = 0; i < count; i++) {
    const tick = center - spread + (i * spread * 2) / count;
    const roundedTick = Math.round(tick / 10) * 10;
    const dist = Math.abs(tick - center) / spread;
    const liq = Math.max(0, (1 - dist * dist) * 500_000 + Math.random() * 100_000);
    ticks.push({
      tick: roundedTick,
      liquidityNet: String(Math.round(liq)),
      liquidityGross: String(Math.round(liq * 1.1)),
    });
  }
  return ticks;
}

export const MOCK_POOLS: PoolDetail[] = [
  {
    id: 'pool-xlm-usdc-030',
    token0: 'XLM',
    token1: 'USDC',
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    feeTier: '0.30%',
    currentPrice: 0.1085,
    currentTick: -22000,
    tvl: 4_200_000,
    feeApr: 12.4,
    volume24h: 340_000,
  },
  {
    id: 'pool-xlm-usdc-005',
    token0: 'XLM',
    token1: 'USDC',
    token0Symbol: 'XLM',
    token1Symbol: 'USDC',
    feeTier: '0.05%',
    currentPrice: 0.1085,
    currentTick: -22000,
    tvl: 8_100_000,
    feeApr: 3.2,
    volume24h: 1_200_000,
  },
  {
    id: 'pool-btc-xlm-100',
    token0: 'BTC',
    token1: 'XLM',
    token0Symbol: 'BTC',
    token1Symbol: 'XLM',
    feeTier: '1.00%',
    currentPrice: 850000,
    currentTick: 131000,
    tvl: 2_900_000,
    feeApr: 28.7,
    volume24h: 180_000,
  },
];
