"use client";

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/constants";

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface SwapInfo {
  id: string;
  timestamp: number;
  token0Amount: string;
  token1Amount: string;
  price: string;
  type: "buy" | "sell";
  txHash: string;
}

export interface PoolDetail {
  id: string;
  token0: TokenInfo;
  token1: TokenInfo;
  feeTier: number;
  currentSqrtPrice: string;
  currentTick: number;
  totalLiquidity: string;
  tvl: string;
  volume24h: string;
  volume7d: string;
  feeApr: string;
  creationTimestamp: number;
  recentSwaps: SwapInfo[];
}

export function usePoolDetail(poolId: string | null) {
  return useQuery<PoolDetail>({
    queryKey: ["poolDetail", poolId],
    queryFn: async () => {
      if (!poolId) throw new Error("Pool ID required");
      const res = await fetch(`${API_BASE}/pools/${poolId}`);
      if (!res.ok) throw new Error(`Failed to fetch pool: ${res.status}`);
      return res.json();
    },
    enabled: !!poolId,
    refetchInterval: 30_000,
  });
}
