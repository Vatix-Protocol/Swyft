'use client';

import { useEffect, useState } from 'react';
import type { Token } from '@swyft/ui';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

const RECENT_KEY = 'swyft_recent_tokens';
const RECENT_MAX = 5;

export function useTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch(`${API_BASE}/pools`)
      .then((r) => r.json())
      .then((data: { items?: Array<{ token0: string; token1: string }> }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: Token[] = [];
        for (const pool of data.items ?? []) {
          for (const raw of [pool.token0, pool.token1]) {
            if (seen.has(raw)) continue;
            seen.add(raw);
            list.push({
              id: raw,
              symbol: raw.length > 8 ? `${raw.slice(0, 4)}…` : raw,
              name: raw,
              logoUrl: null,
            });
          }
        }
        setTokens(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTokens([]);
          setError(err instanceof Error ? err : new Error('Failed to load tokens'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { tokens, loading, error };
}

export function useRecentTokens() {
  function get(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  }
  function push(id: string) {
    const prev = get().filter((x) => x !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, RECENT_MAX)));
  }
  return { recentIds: get(), pushRecent: push };
}

export function usePoolId(
  tokenInId: string | null,
  tokenOutId: string | null,
  feeTier?: number | null
) {
  const [poolId, setPoolId] = useState<string | null>(null);
  const [poolExists, setPoolExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tokenInId || !tokenOutId) {
      setPoolId(null);
      setPoolExists(null);
      return;
    }
    let cancelled = false;

    apiFetch(`${API_BASE}/pools`)
      .then((r) => r.json())
      .then(
        (data: {
          items?: Array<{ id: string; token0: string; token1: string; feeTier: number | string }>;
        }) => {
          if (cancelled) return;
          const candidates = (data.items ?? []).filter(
            (p) =>
              (p.token0 === tokenInId && p.token1 === tokenOutId) ||
              (p.token0 === tokenOutId && p.token1 === tokenInId)
          );

          let match: (typeof candidates)[number] | undefined;
          if (feeTier != null) {
            // Multiple fee-tier pools can exist for the same pair; only
            // treat it as a match if the fee tier is also honored.
            match = candidates.find((p) => Number(p.feeTier) === feeTier);
          } else {
            // No fee tier requested: fall back deterministically to the
            // lowest fee-tier pool rather than an arbitrary array order.
            match = [...candidates].sort((a, b) => Number(a.feeTier) - Number(b.feeTier))[0];
          }

          setPoolId(match?.id ?? null);
          setPoolExists(candidates.length > 0 ? !!match : false);
        }
      )
      .catch(() => {
        if (!cancelled) {
          setPoolId(null);
          setPoolExists(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tokenInId, tokenOutId, feeTier]);

  return { poolId, poolExists };
}
