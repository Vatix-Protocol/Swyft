'use client';

import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@/lib/constants';

export type LpActivityType = 'mint' | 'burn' | 'fee_collection';

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
  limit: number = 20,
  poolId?: string | null
) {
  return useQuery({
    queryKey: ['lp-activity', walletAddress, page, limit, poolId ?? null],
    queryFn: async (): Promise<LpActivityListResponse> => {
      if (!walletAddress || !authToken) return { items: [], total: 0 };

      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (poolId) params.set('pool', poolId);

      const response = await fetch(`${API_BASE}/positions/activity?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch LP activity');
      }

      const data = await response.json();

      return { items: data.items ?? [], total: data.total ?? 0 };
    },
    enabled: !!walletAddress && !!authToken,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
