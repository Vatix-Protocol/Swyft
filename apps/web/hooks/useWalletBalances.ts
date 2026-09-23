'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '@/lib/constants';
import { apiFetch } from '@/lib/api-fetch';
import { useTransactionStatus } from '@/context/TransactionStatusContext';

/**
 * Fetches token balances for a connected wallet address.
 * Returns a map of tokenId → balance string.
 *
 * Balances are automatically invalidated once a swap reports success via
 * `TransactionStatusContext`, so callers don't need to manually refetch.
 */
export function useWalletBalances(address: string | null, tokenIds: string[]) {
  const queryClient = useQueryClient();
  const { pendingTx } = useTransactionStatus();
  const tokenIdsKey = tokenIds.join(',');

  const { data } = useQuery<Record<string, string>>({
    queryKey: ['walletBalances', address, tokenIdsKey],
    queryFn: async () => {
      if (!address) throw new Error('Wallet address required');
      // GET /v1/balances is behind ApiKeyGuard like the other read-only
      // market-data endpoints, so this must go through apiFetch to attach
      // X-Api-Key when one is configured.
      const res = await apiFetch(`${API_BASE}/balances?address=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error('Failed to fetch balances');
      return res.json();
    },
    enabled: !!address && tokenIds.length > 0,
  });

  // Dedup on txHash so a re-render with the same "success" status doesn't
  // trigger a repeat invalidation/refetch.
  const lastInvalidatedTxHash = useRef<string | null>(null);
  useEffect(() => {
    if (!address || pendingTx?.status !== 'success') return;
    if (lastInvalidatedTxHash.current === pendingTx.txHash) return;
    lastInvalidatedTxHash.current = pendingTx.txHash;
    queryClient.invalidateQueries({ queryKey: ['walletBalances', address] });
  }, [address, pendingTx, queryClient]);

  return data ?? {};
}
