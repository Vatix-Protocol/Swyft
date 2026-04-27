'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'swyft:mev_protection';

export function useMevProtection() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  const toggle = (value: boolean) => {
    setEnabled(value);
    localStorage.setItem(STORAGE_KEY, String(value));
  };

  const rpcUrl = enabled
    ? (process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL ?? process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org')
    : (process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org');

  return { enabled, toggle, rpcUrl };
}
