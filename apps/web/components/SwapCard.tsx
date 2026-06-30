'use client';

import { SwapWidget } from './SwapWidget';
import { useWallet } from '@/hooks/useWallet';

export function SwapCard() {
  const wallet = useWallet();

  return <SwapWidget wallet={{ address: wallet.address }} />;
}


