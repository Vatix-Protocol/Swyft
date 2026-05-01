"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/constants";

/**
 * Fetches token balances for a connected wallet address.
 * Returns a map of tokenId → balance string.
 */
export function useWalletBalances(address: string | null, tokenIds: string[]) {
  const [balances, setBalances] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!address || tokenIds.length === 0) { setBalances({}); return; }
    let cancelled = false;

    fetch(`${API_BASE}/balances?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (!cancelled) setBalances(data);
      })
      .catch(() => { if (!cancelled) setBalances({}); });

    return () => { cancelled = true; };
  }, [address, tokenIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return balances;
}
