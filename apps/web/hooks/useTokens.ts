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

    apiFetch(`${API_BASE}/tokens?limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load tokens (${r.status})`);
        return r.json();
      })
      .then(
        (data: {
          contractAddress?: string;
          symbol: string;
          name: string;
          logoUri: string | null;
        }[] | { items?: Array<{ contractAddress: string; symbol: string; name: string; logoUri: string | null }> }) => {
          if (cancelled) return;
          const items = Array.isArray(data) ? data : data.items ?? [];
          const list: Token[] = items.map((t) => ({
            id: t.contractAddress ?? '',
            symbol: t.symbol,
            name: t.name,
            logoUrl: t.logoUri ?? null,
          }));
          setTokens(list);
        }
      )
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
  const [feeTier, setFeeTier] = useState<number | null>(null);

  useEffect(() => {
    if (!tokenInId || !tokenOutId) {
      setPoolId(null);
      setPoolExists(null);
      setFeeTier(null);
      return;
    }
    let cancelled = false;

    apiFetch(`${API_BASE}/pools`)
      .then((r) => r.json())
      .then(
        (data: {
          items?: Array<{ id: string; token0: string; token1: string; feeTier?: number }>;
        }) => {
          if (cancelled) return;
          const match = (data.items ?? []).find(
            (p) =>
              (p.token0 === tokenInId && p.token1 === tokenOutId) ||
              (p.token0 === tokenOutId && p.token1 === tokenInId)
          );
          setPoolId(match?.id ?? null);
          setPoolExists(!!match);
          setFeeTier(match?.feeTier ?? null);
        }
      )
      .catch(() => {
        if (!cancelled) {
          setPoolId(null);
          setPoolExists(null);
          setFeeTier(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tokenInId, tokenOutId, feeTier]);

  return { poolId, poolExists, feeTier };
}
