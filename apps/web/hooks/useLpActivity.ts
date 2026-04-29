"use client";

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/constants";

export type LpActivityType = "mint" | "burn" | "fee_collection";

export interface LpActivity {
  id: string;
  type: LpActivityType;
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  txHash: string;
  walletAddress: string;
  timestamp: number;
}

export interface LpActivityListResponse {
  items: LpActivity[];
  total: number;
}

export function useLpActivity(
  walletAddress: string | null,
  authToken: string | null,
  page: number = 1,
  limit: number = 20
) {
  return useQuery({
    queryKey: ["lp-activity", walletAddress, page, limit],
    queryFn: async (): Promise<LpActivityListResponse> => {
      if (!walletAddress || !authToken) return { items: [], total: 0 };
      
      const params = new URLSearchParams({
        wallet: walletAddress,
        page: page.toString(),
        limit: limit.toString(),
      });

      const response = await fetch(`${API_BASE}/positions?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch LP activity");
      }
      
      const data = await response.json();
      
      // Transform positions into LP activity entries
      // This is a placeholder - the actual API should return LP activity directly
      // For now, we'll derive activity from position data
      const activities: LpActivity[] = (data.items || []).map((pos: any) => ({
        id: pos.id,
        type: "mint" as LpActivityType,
        poolId: pos.poolId,
        token0Symbol: pos.token0,
        token1Symbol: pos.token1,
        amount0: pos.liquidity,
        amount1: "0",
        txHash: pos.id, // Placeholder - should be actual tx hash
        walletAddress: pos.ownerWallet,
        timestamp: pos.createdAt,
      }));
      
      return { items: activities, total: data.total || 0 };
    },
    enabled: !!walletAddress && !!authToken,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
