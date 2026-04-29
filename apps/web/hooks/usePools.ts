"use client";

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/constants";

export type PoolOrderBy = "tvl" | "volume" | "apr";

export interface PoolListItem {
  id: string;
  token0: string;
  token1: string;
  feeTier: string;
  tvl: number;
  volume24h: number;
  volume7d: number;
  feeApr: number;
  currentPrice: number;
}

export interface PoolsResponse {
  items: PoolListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UsePoolsParams {
  page: number;
  orderBy: PoolOrderBy;
  search: string;
}

export function usePools({ page, orderBy, search }: UsePoolsParams) {
  return useQuery<PoolsResponse>({
    queryKey: ["pools", page, orderBy, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
        orderBy,
        ...(search ? { search } : {}),
      });
      const res = await fetch(`${API_BASE}/pools?${params}`);
      if (!res.ok) throw new Error("Failed to fetch pools");
      return res.json();
    },
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
