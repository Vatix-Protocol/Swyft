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
 * Wire shape of a single item returned by `GET /swaps`
 * (see `SwapResponse` in apps/api/src/swaps/swaps.service.ts).
 */
export interface SwapsApiItem {
  id: string;
  poolId: string;
  tokenPair: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  feeAmount: string;
  route?: string[];
  transactionHash: string;
  walletAddress: string;
  timestamp: number;
}

/** Wire shape of `GET /swaps` (see `SwapsListResponse` in the API). */
export interface SwapsApiResponse {
  items: SwapsApiItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Builds the `GET /swaps` URL. Query parameter names must match
 * `GetSwapsQueryDto` (apps/api/src/swaps/dto/get-swaps-query.dto.ts).
 */
export function buildSwapsUrl(walletAddress: string, page: number, limit: number): string {
  const params = new URLSearchParams({
    wallet: walletAddress,
    page: page.toString(),
    limit: limit.toString(),
  });
  return `${API_BASE}/swaps?${params}`;
}

export function parseSwapsResponse(body: SwapsApiResponse): SwapsListResponse {
  return {
    items: body.items.map((item) => ({
      id: item.id,
      poolId: item.poolId,
      token0Symbol: item.token0Symbol,
      token1Symbol: item.token1Symbol,
      amount0: item.amount0,
      amount1: item.amount1,
      priceAtSwap: item.priceAtSwap,
      ...(item.route ? { route: item.route } : {}),
      txHash: item.transactionHash,
      walletAddress: item.walletAddress,
      timestamp: item.timestamp,
    })),
    total: body.total,
  };
}

export function useSwaps(walletAddress: string | null, page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: ['swaps', walletAddress, page, limit],
    queryFn: async (): Promise<SwapsListResponse> => {
      if (!walletAddress) return { items: [], total: 0 };

      const response = await apiFetch(buildSwapsUrl(walletAddress, page, limit));
      if (!response.ok) {
        throw new Error('Failed to fetch swaps');
      }
      return parseSwapsResponse((await response.json()) as SwapsApiResponse);
    },
    enabled: !!walletAddress,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
