'use client';

import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

export interface SwapSnapshot {
  id: string;
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  /** Ordered pool IDs the swap routed through, when known (e.g. multi-hop). */
  route?: string[];
  txHash: string;
  walletAddress: string;
  timestamp: number;
}

export interface SwapsListResponse {
  items: SwapSnapshot[];
  total: number;
}

/**
 * A single item as returned by `GET /swaps` (see `SwapResponse` in
 * apps/api/src/swaps/swaps.service.ts). The API names the hash
 * `transactionHash`; it is mapped to `txHash` on the client.
 */
interface ApiSwapItem {
  id: string;
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  route?: string[];
  transactionHash: string;
  walletAddress: string;
  timestamp: number;
}

interface ApiSwapsListResponse {
  items?: ApiSwapItem[];
  total?: number;
}

function toSwapSnapshot(item: ApiSwapItem): SwapSnapshot {
  return {
    id: item.id,
    poolId: item.poolId,
    token0Symbol: item.token0Symbol,
    token1Symbol: item.token1Symbol,
    amount0: item.amount0,
    amount1: item.amount1,
    priceAtSwap: item.priceAtSwap,
    ...(Array.isArray(item.route) ? { route: item.route } : {}),
    txHash: item.transactionHash,
    walletAddress: item.walletAddress,
    timestamp: item.timestamp,
  };
}

export function useSwaps(walletAddress: string | null, page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: ['swaps', walletAddress, page, limit],
    queryFn: async (): Promise<SwapsListResponse> => {
      if (!walletAddress) return { items: [], total: 0 };

      // `wallet`, `page` and `limit` match GetSwapsQueryDto on the API.
      const params = new URLSearchParams({
        wallet: walletAddress,
        page: page.toString(),
        limit: limit.toString(),
      });

      const response = await apiFetch(`${API_BASE}/swaps?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch swaps');
      }
      const data = (await response.json()) as ApiSwapsListResponse;
      return {
        items: (data.items ?? []).map(toSwapSnapshot),
        total: data.total ?? 0,
      };
    },
    enabled: !!walletAddress,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
