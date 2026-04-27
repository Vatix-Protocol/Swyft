"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PositionRangeBadge, type PositionSnapshot } from "@swyft/ui";
import { estimateRemoveAmounts } from "@swyft/sdk";
import { useRemoveLiquidity } from "@/hooks/useRemoveLiquidity";

const PRESETS = [25, 50, 75, 100];

function rangeStatus(p: PositionSnapshot): "in-range" | "out-of-range" | "closed" {
  if (p.status === "closed") return "closed";
  const price = p.poolCurrentPrice;
  const lower = Math.pow(1.0001, p.lowerTick);
  const upper = Math.pow(1.0001, p.upperTick);
  return price >= lower && price <= upper ? "in-range" : "out-of-range";
}

interface Props {
  position: PositionSnapshot;
  token0Symbol: string;
  token1Symbol: string;
  authToken: string;
  onSuccess?: () => void;
}

export function RemoveLiquidityPanel({ position, token0Symbol, token1Symbol, authToken, onSuccess }: Props) {
  const router = useRouter();
  const [pct, setPct] = useState(100);
  const [customInput, setCustomInput] = useState("100");
  const { status, txError, txHash, removeLiquidity, collectFees, reset } = useRemoveLiquidity(position, authToken);

  const estimates = estimateRemoveAmounts(
    position.liquidity,
    pct,
    position.poolCurrentPrice,
    position.lowerTick,
    position.upperTick
  );

  const lowerPrice = Math.pow(1.0001, position.lowerTick).toFixed(6);
  const upperPrice = Math.pow(1.0001, position.upperTick).toFixed(6);
  const rs = rangeStatus(position);

  const isBusy = status === "signing" || status === "submitting";
  const alreadyClosed = position.status === "closed";

  useEffect(() => {
    if (status === "success") {
      onSuccess?.();
      // If 100% removed, navigate back to portfolio after short delay
      if (pct === 100) {
        const t = setTimeout(() => router.push("/portfolio"), 2000);
        return () => clearTimeout(t);
      }
    }
  }, [status, pct, router, onSuccess]);

  function handlePctInput(v: string) {
    setCustomInput(v);
    const n = parseFloat(v);
    if (!isNaN(n) && n >= 1 && n <= 100) setPct(Math.round(n));
  }

  function handlePreset(p: number) {
    setPct(p);
    setCustomInput(String(p));
  }

  return (
    <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
            Remove liquidity
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {token0Symbol} / {token1Symbol}
          </p>
        </div>
        <PositionRangeBadge status={rs} />
      </div>

      <div className="flex flex-col gap-4 p-5">
        {/* Position details */}
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
          <div className="flex flex-col gap-1.5 text-zinc-500 dark:text-zinc-400">
            <div className="flex justify-between">
              <span>Price range</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {lowerPrice} – {upperPrice} {token1Symbol}/{token0Symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Current price</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {position.poolCurrentPrice.toFixed(6)} {token1Symbol}/{token0Symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Position value</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                ${position.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Uncollected fees */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 dark:border-indigo-900/40 dark:bg-indigo-950/30">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-indigo-700 dark:text-indigo-400">Uncollected fees</p>
            <button
              type="button"
              onClick={collectFees}
              disabled={isBusy || alreadyClosed}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
            >
              Collect fees only
            </button>
          </div>
          <div className="flex flex-col gap-1 text-xs text-indigo-600 dark:text-indigo-300">
            <div className="flex justify-between">
              <span>{token0Symbol}</span>
              <span className="font-medium tabular-nums">{parseFloat(position.uncollectedFeesToken0).toFixed(7)}</span>
            </div>
            <div className="flex justify-between">
              <span>{token1Symbol}</span>
              <span className="font-medium tabular-nums">{parseFloat(position.uncollectedFeesToken1).toFixed(7)}</span>
            </div>
          </div>
        </div>

        {/* Percentage selector */}
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Amount to remove</p>
          <div className="flex items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePreset(p)}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  pct === p
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {p}%
              </button>
            ))}
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
              <input
                type="text"
                inputMode="decimal"
                value={customInput}
                onChange={(e) => handlePctInput(e.target.value)}
                aria-label="Custom removal percentage"
                className="w-10 bg-transparent text-xs text-zinc-900 focus:outline-none dark:text-white"
              />
              <span className="text-xs text-zinc-400">%</span>
            </div>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={1}
            max={100}
            value={pct}
            onChange={(e) => { const v = Number(e.target.value); setPct(v); setCustomInput(String(v)); }}
            aria-label="Removal percentage slider"
            className="mt-3 w-full accent-indigo-600"
          />
        </div>

        {/* Estimated receive */}
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
          <p className="mb-2 font-medium text-zinc-500 dark:text-zinc-400">You will receive (estimated)</p>
          <div className="flex flex-col gap-1.5 text-zinc-700 dark:text-zinc-300">
            <div className="flex justify-between">
              <span>{token0Symbol}</span>
              <span className="font-semibold tabular-nums">{estimates.amount0}</span>
            </div>
            <div className="flex justify-between">
              <span>{token1Symbol}</span>
              <span className="font-semibold tabular-nums">{estimates.amount1}</span>
            </div>
          </div>
        </div>

        {/* Status feedback */}
        {status === "success" && (
          <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
            {pct === 100 ? "Position closed successfully." : "Liquidity removed successfully."}{" "}
            {txHash && <span className="font-mono opacity-70">{txHash.slice(0, 12)}…</span>}
            {pct === 100 && " Redirecting to portfolio…"}
          </div>
        )}

        {status === "error" && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                {txError === "rejected" && "Transaction rejected in wallet."}
                {txError === "already_closed" && "This position has already been closed."}
                {txError === "network" && "Network error — please try again."}
              </p>
              <button type="button" onClick={reset} className="mt-1 text-xs text-red-500 underline hover:text-red-700">
                Dismiss
              </button>
            </div>
          </div>
        )}

        {alreadyClosed && status === "idle" && (
          <p role="alert" className="text-xs text-zinc-400">This position is already closed.</p>
        )}

        {/* Remove button */}
        <button
          type="button"
          onClick={() => removeLiquidity(pct)}
          disabled={isBusy || alreadyClosed || status === "success"}
          className="w-full rounded-xl bg-red-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "signing" && "Waiting for signature…"}
          {status === "submitting" && "Submitting…"}
          {(status === "idle" || status === "error") && `Remove ${pct}% liquidity`}
          {status === "success" && "Removed ✓"}
        </button>
      </div>
    </div>
  );
}
