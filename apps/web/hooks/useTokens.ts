"use client";

import { useEffect, useState } from "react";
import type { Token } from "@swyft/ui";
import { API_BASE } from "@/lib/constants";

const RECENT_KEY = "swyft_recent_tokens";
const RECENT_MAX = 5;

export function useTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`${API_BASE}/pools`)
      .then((r) => r.json())
      .then((data: { items?: Array<{ token0: string; token1: string }> }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: Token[] = [];
        for (const pool of data.items ?? []) {
          for (const raw of [pool.token0, pool.token1]) {
            if (seen.has(raw)) continue;
            seen.add(raw);
            list.push({ id: raw, symbol: raw.length > 8 ? `${raw.slice(0, 4)}…` : raw, name: raw, logoUrl: null });
          }
        }
        setTokens(list);
      })
      .catch(() => { if (!cancelled) setTokens([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { tokens, loading };
}

export function useRecentTokens() {
  function get(): string[] {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
    catch { return []; }
  }
  function push(id: string) {
    const prev = get().filter((x) => x !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, RECENT_MAX)));
  }
  return { recentIds: get(), pushRecent: push };
}

export function usePoolId(tokenInId: string | null, tokenOutId: string | null) {
  const [poolId, setPoolId] = useState<string | null>(null);
  const [poolExists, setPoolExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tokenInId || !tokenOutId) { setPoolId(null); setPoolExists(null); return; }
    let cancelled = false;

    fetch(`${API_BASE}/pools`)
      .then((r) => r.json())
      .then((data: { items?: Array<{ id: string; token0: string; token1: string }> }) => {
        if (cancelled) return;
        const match = (data.items ?? []).find(
          (p) =>
            (p.token0 === tokenInId && p.token1 === tokenOutId) ||
            (p.token0 === tokenOutId && p.token1 === tokenInId)
        );
        setPoolId(match?.id ?? null);
        setPoolExists(!!match);
      })
      .catch(() => { if (!cancelled) { setPoolId(null); setPoolExists(null); } });

    return () => { cancelled = true; };
  }, [tokenInId, tokenOutId]);

  return { poolId, poolExists };
}
