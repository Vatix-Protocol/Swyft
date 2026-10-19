'use client';

import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';

/**
 * One item of the API's `GET /swaps` list response (see `toResponse` in
 * apps/api/src/swaps/swaps.service.ts). Field names must match that contract.
 */
export interface SwapSnapshot {
  id: string;
  poolId: string;
  /** Normalized "TOKEN0/TOKEN1" label for the trading pair. */
  tokenPair: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  /** Fee charged for this swap (expressed in token0 units). */
  feeAmount: string;
  /** Ordered pool IDs the swap routed through, when known (e.g. multi-hop). */
  route?: string[];
  transactionHash: string;
  walletAddress: string;
  timestamp: number;
}

export interface SwapsListResponse {
  items: SwapSnapshot[];
  total: number;
}

export function useSwaps(walletAddress: string | null, page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: ['swaps', walletAddress, page, limit],
    queryFn: async (): Promise<SwapsListResponse> => {
      if (!walletAddress) return { items: [], total: 0 };

      // `wallet` is the filter accepted by GetSwapsQueryDto on the API.
      const params = new URLSearchParams({
        wallet: walletAddress,
        page: page.toString(),
        limit: limit.toString(),
      });

      const response = await apiFetch(`${API_BASE}/swaps?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch swaps');
      }
      return response.json();
    },
    enabled: !!walletAddress,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
