"use client";

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/constants";

export interface SwapSnapshot {
  id: string;
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  txHash: string;
  walletAddress: string;
  timestamp: number;
}

export interface SwapsListResponse {
  items: SwapSnapshot[];
  total: number;
}

export function useSwaps(walletAddress: string | null, page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: ["swaps", walletAddress, page, limit],
    queryFn: async (): Promise<SwapsListResponse> => {
      if (!walletAddress) return { items: [], total: 0 };
      
      const params = new URLSearchParams({
        wallet: walletAddress,
        page: page.toString(),
        limit: limit.toString(),
      });

      const response = await fetch(`${API_BASE}/swaps?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch swaps");
      }
      return response.json();
    },
    enabled: !!walletAddress,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
