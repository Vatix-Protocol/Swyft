'use client';

import { useQuery } from '@tanstack/react-query';
import { useNetworkContext } from '@/context/NetworkContext';
import { apiFetch } from '@/lib/api-fetch';

export type PoolOrderBy = 'tvl' | 'volume' | 'apr';

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

/**
 * Detect a misconfigured PUBLIC/mainnet deployment.
 *
 * Next.js bakes NEXT_PUBLIC_* vars into the client bundle at build time.
 * When NEXT_PUBLIC_API_URL_PUBLIC is blank and the user has selected the PUBLIC
 * network, `getApiBase` silently falls back to the TESTNET or localhost URL —
 * serving wrong-network data without a visible error.
 *
 * This guard returns a human-readable message when that condition is detected
 * so the pools page can surface it as a hard error rather than showing stale
 * or incorrect data.
 *
 * INVARIANT: always returns `null` on TESTNET so this never fires in local dev.
 */
function detectApiMisconfiguration(network: string, apiBase: string): string | null {
  if (network !== 'PUBLIC') return null;

  const publicOverride = process.env.NEXT_PUBLIC_API_URL_PUBLIC;
  if (!publicOverride) {
    // The PUBLIC network override was not baked in at build time.
    // apiBase has fallen back to the testnet/localhost URL.
    return (
      'NEXT_PUBLIC_API_URL_PUBLIC is not set for this build. ' +
      'The pool list cannot be served from the mainnet API. ' +
      'Rebuild the Docker image with --build-arg NEXT_PUBLIC_API_URL_PUBLIC=<mainnet-api-url>.'
    );
  }

  // Catch a localhost or testnet URL that was accidentally baked in for
  // a PUBLIC deployment.
  if (
    publicOverride.includes('localhost') ||
    publicOverride.includes('testnet') ||
    publicOverride.includes('127.0.0.1')
  ) {
    return (
      `NEXT_PUBLIC_API_URL_PUBLIC ("${publicOverride}") looks like a testnet or local ` +
      'URL but the active network is PUBLIC (mainnet). Pool data will be incorrect. ' +
      'Rebuild with the correct mainnet API URL.'
    );
  }

  void apiBase; // intentionally unused — guard is env-based, not URL-based
  return null;
}

export function usePools({ page, orderBy, search }: UsePoolsParams) {
  const { network, apiBase } = useNetworkContext();

  // Fail loudly when the production API URL is not configured rather than
  // silently serving data from the wrong network.
  const misconfigError = detectApiMisconfiguration(network, apiBase);

  const query = useQuery<PoolsResponse>({
    queryKey: ['pools', network, page, orderBy, search],
    queryFn: async () => {
      if (misconfigError) {
        // Throw so React Query puts this into an error state.  The pools page
        // renders the error message via its isError branch.
        throw new Error(misconfigError);
      }

      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        orderBy,
        ...(search ? { search } : {}),
      });
      const res = await apiFetch(`${apiBase}/pools?${params}`);
      if (!res.ok) throw new Error('Failed to fetch pools');
      return res.json();
    },
    // Don't retry on the misconfiguration error — it won't resolve without a
    // redeploy.
    retry: misconfigError ? false : 3,
    placeholderData: (prev) => prev,
    refetchInterval: misconfigError ? false : 30_000,
  });

  const isStale = query.data === undefined && !query.isLoading;

  return { ...query, isStale, misconfigError };
}
