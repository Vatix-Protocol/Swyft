'use client';

import { SwapWidget } from './SwapWidget';
import { useWalletContext } from '@/context/WalletContext';

export function SwapCard() {
  // Use the shared WalletContext (which is wired to the live
  // NetworkSwitcher selection) instead of calling useWallet() directly.
  // useWallet() on its own defaults to the build-time SWYFT_NETWORK, so a
  // direct call here would validate the connected wallet against the wrong
  // network whenever the user switches networks at runtime.
  const wallet = useWalletContext();

  return <SwapWidget wallet={{ address: wallet.address }} />;
}


