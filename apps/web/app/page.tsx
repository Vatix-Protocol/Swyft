"use client";

import { useState } from "react";
import { SwapWidget } from "@/components/SwapWidget";
import { PriceChart } from "@/components/PriceChart";
import { useWalletContext } from "@/context/WalletContext";
import type { Token } from "@swyft/ui";

export default function Home() {
  const wallet = useWalletContext();
  const [tokenIn, setTokenIn] = useState<Token | null>(null);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black min-h-screen px-4 py-6 sm:p-8 overflow-x-hidden">
      <div className="w-full max-w-md flex flex-col gap-4">
        <PriceChart
          tokenA={tokenIn?.id ?? null}
          tokenB={tokenOut?.id ?? null}
          tokenASymbol={tokenIn?.symbol}
          tokenBSymbol={tokenOut?.symbol}
        />
        <SwapWidget
          wallet={wallet}
          onTokenInChange={setTokenIn}
          onTokenOutChange={setTokenOut}
        />
      </div>
    </div>
  );
}
