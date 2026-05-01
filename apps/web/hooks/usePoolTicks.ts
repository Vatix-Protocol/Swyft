"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/constants";

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

export function usePoolTicks(poolId: string | null) {
  const [ticks, setTicks] = useState<TickData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!poolId) { setTicks([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/pools/${poolId}/ticks`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load tick data");
        return r.json() as Promise<TickData[]>;
      })
      .then((data) => { if (!cancelled) setTicks(data); })
      .catch(() => {
        if (!cancelled) {
          setTicks(generateSyntheticTicks());
          setError(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [poolId]);

  return { ticks, loading, error };
}

export function usePools() {
  const [pools, setPools] = useState<PoolDetail[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`${API_BASE}/pools?limit=50&orderBy=tvl`)
      .then((r) => r.json())
      .then((data: { items?: PoolDetail[] }) => {
        if (!cancelled) setPools(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setPools(MOCK_POOLS);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { pools, loading };
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
    id: "pool-xlm-usdc-030",
    token0: "XLM",
    token1: "USDC",
    token0Symbol: "XLM",
    token1Symbol: "USDC",
    feeTier: "0.30%",
    currentPrice: 0.1085,
    currentTick: -22000,
    tvl: 4_200_000,
    feeApr: 12.4,
    volume24h: 340_000,
  },
  {
    id: "pool-xlm-usdc-005",
    token0: "XLM",
    token1: "USDC",
    token0Symbol: "XLM",
    token1Symbol: "USDC",
    feeTier: "0.05%",
    currentPrice: 0.1085,
    currentTick: -22000,
    tvl: 8_100_000,
    feeApr: 3.2,
    volume24h: 1_200_000,
  },
  {
    id: "pool-btc-xlm-100",
    token0: "BTC",
    token1: "XLM",
    token0Symbol: "BTC",
    token1Symbol: "XLM",
    feeTier: "1.00%",
    currentPrice: 850000,
    currentTick: 131000,
    tvl: 2_900_000,
    feeApr: 28.7,
    volume24h: 180_000,
  },
];
