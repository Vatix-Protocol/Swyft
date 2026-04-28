"use client";

import { useAddLiquidity, tickToPrice } from "@/hooks/useAddLiquidity";
import { usePoolTicks } from "@/hooks/usePoolTicks";
import { useWalletContext } from "@/context/WalletContext";
import { PoolSelector } from "./PoolSelector";
import { RangeSelector } from "./RangeSelector";
import { AmountInputs } from "./AmountInputs";
import { PositionPreview } from "./PositionPreview";

export function AddLiquidity() {
  const {
    pool, lowerTick, upperTick, lowerPrice, upperPrice,
    amount0, amount1, txStatus, txHash, txError, positionNftId,
    isFullRange, preview,
    setPool, setLowerTick, setUpperTick, setLowerPrice, setUpperPrice,
    setAmount0, setAmount1, setFullRange, submit, reset,
  } = useAddLiquidity();

  const { ticks } = usePoolTicks(pool?.id ?? null);
  const { address, signTransaction } = useWalletContext();

  const token0Symbol = pool?.token0Symbol ?? pool?.token0 ?? "Token A";
  const token1Symbol = pool?.token1Symbol ?? pool?.token1 ?? "Token B";

  // When price is below range, only token0 needed; above range, only token1
  const currentPrice = pool?.currentPrice ?? 0;
  const lp = tickToPrice(lowerTick);
  const up = tickToPrice(upperTick);
  const token0Only = currentPrice < lp;
  const token1Only = currentPrice > up;

  async function handleSubmit() {
    if (!address || !signTransaction) return;
    await submit(address, signTransaction);
  }

  return (
    <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Add liquidity</h2>
        <p className="mt-0.5 text-xs text-zinc-400">Provide concentrated liquidity and earn fees</p>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {/* Step 1: Pool */}
        <PoolSelector selected={pool} onSelect={setPool} />

        {pool && (
          <>
            {/* Step 2: Range */}
            <RangeSelector
              ticks={ticks}
              currentTick={pool.currentTick}
              lowerTick={lowerTick}
              upperTick={upperTick}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              lowerPrice={lowerPrice}
              upperPrice={upperPrice}
              onLowerTickChange={setLowerTick}
              onUpperTickChange={setUpperTick}
              onLowerPriceChange={setLowerPrice}
              onUpperPriceChange={setUpperPrice}
              onFullRange={setFullRange}
              isFullRange={isFullRange}
            />

            {/* Step 3: Amounts */}
            <AmountInputs
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              amount0={amount0}
              amount1={amount1}
              token0Only={token0Only}
              token1Only={token1Only}
              onAmount0Change={setAmount0}
              onAmount1Change={setAmount1}
            />

            {/* Step 4: Preview + Submit */}
            <PositionPreview
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              amount0={amount0}
              amount1={amount1}
              lowerPrice={lowerPrice}
              upperPrice={upperPrice}
              shareOfPool={preview.shareOfPool}
              estimatedApr={preview.estimatedApr}
              inRange={preview.inRange}
              currentPrice={currentPrice}
              txStatus={txStatus}
              txError={txError}
              txHash={txHash}
              positionNftId={positionNftId}
              onSubmit={handleSubmit}
              onReset={reset}
              isWalletConnected={!!address}
            />
          </>
        )}

        {!pool && (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <p className="text-xs text-zinc-400">Select a pool above to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
