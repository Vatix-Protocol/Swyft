'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useWallet, WalletState } from '@/hooks/useWallet';
import { useNetworkContext } from '@/context/NetworkContext';

const WalletContext = createContext<WalletState | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { network } = useNetworkContext();
  const wallet = useWallet(network);
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWalletContext must be used inside WalletProvider');
  return ctx;
}
