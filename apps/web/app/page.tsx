'use client';

import { useState } from 'react';
import { SwapWidget } from '@/components/SwapWidget';
import { PriceChart } from '@/components/PriceChart';
import { useWalletContext } from '@/context/WalletContext';
import type { Token } from '@swyft/ui';

export default function Home() {
  const wallet = useWalletContext();
  const [tokenIn, setTokenIn] = useState<Token | null>(null);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black min-h-screen px-4 py-6 sm:px-6 sm:py-8 overflow-x-hidden">
      {/*
       * Mobile  (< md): single column — chart stacked above swap widget, full width.
       * Tablet+ (≥ md): two-column row — chart on the left, swap widget on the right.
       * The wrapper is capped at max-w-5xl so it doesn't stretch too wide on large monitors.
       */}
      <div className="w-full max-w-5xl flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
        {/* Chart — full width on mobile, fills remaining space on md+ */}
        <div className="w-full md:flex-1 min-w-0">
          <PriceChart
            tokenA={tokenIn?.id ?? null}
            tokenB={tokenOut?.id ?? null}
            tokenASymbol={tokenIn?.symbol}
            tokenBSymbol={tokenOut?.symbol}
          />
        </div>

        {/* Swap widget — full width on mobile, fixed max-width column on md+ */}
        <div className="w-full md:w-auto md:shrink-0">
          <SwapWidget wallet={wallet} onTokenInChange={setTokenIn} onTokenOutChange={setTokenOut} />
        </div>
      </div>
    </div>
  );
}
