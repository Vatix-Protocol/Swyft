"use client";

import Link from "next/link";
import type { TxStatus } from "@/hooks/useAddLiquidity";

interface Props {
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  lowerPrice: string;
  upperPrice: string;
  shareOfPool: string;
  estimatedApr: string;
  inRange: boolean;
  currentPrice: number;
  txStatus: TxStatus;
  txError: string | null;
  txHash: string | null;
  positionNftId: string | null;
  onSubmit: () => void;
  onReset: () => void;
  isWalletConnected: boolean;
}

export function PositionPreview({
  token0Symbol,
  token1Symbol,
  amount0,
  amount1,
  lowerPrice,
  upperPrice,
  shareOfPool,
  estimatedApr,
  inRange,
  currentPrice,
  txStatus,
  txError,
  txHash,
  positionNftId,
  onSubmit,
  onReset,
  isWalletConnected,
}: Props) {
  const isBusy = txStatus === "signing" || txStatus === "submitting";
  const hasAmounts = parseFloat(amount0 || "0") > 0 || parseFloat(amount1 || "0") > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Out-of-range warning */}
      {!inRange && hasAmounts && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Price out of range</p>
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-500">
              Current price ({currentPrice.toFixed(6)}) is outside your selected range. Your position will not earn fees until the price moves into range.
            </p>
          </div>
        </div>
      )}

      {/* Preview card */}
      <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <p className="mb-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Position preview</p>
        <div className="flex flex-col gap-2 text-xs">
          <Row label={`${token0Symbol} deposit`} value={parseFloat(amount0 || "0").toFixed(6)} />
          <Row label={`${token1Symbol} deposit`} value={parseFloat(amount1 || "0").toFixed(6)} />
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          <Row label="Price range" value={`${parseFloat(lowerPrice || "0").toFixed(4)} – ${parseFloat(upperPrice || "0").toFixed(4)}`} />
          <Row label="Share of pool" value={`${shareOfPool}%`} />
          <Row
            label="Est. APR"
            value={`${estimatedApr}%`}
            valueClassName="text-emerald-600 dark:text-emerald-400 font-bold"
          />
          <Row
            label="Status"
            value={inRange ? "In range ✓" : "Out of range"}
            valueClassName={inRange ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}
          />
        </div>
      </div>

      {/* Success state */}
      {txStatus === "success" && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/40">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Position created! 🎉
          </p>
          {positionNftId && (
            <p className="mt-1 font-mono text-xs text-emerald-600 dark:text-emerald-500">
              NFT ID: {positionNftId}
            </p>
          )}
          {txHash && (
            <p className="mt-0.5 font-mono text-xs text-emerald-600/70 dark:text-emerald-500/70">
              Tx: {txHash.slice(0, 18)}…
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Link
              href="/portfolio"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              View portfolio →
            </Link>
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
            >
              Add another
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {txStatus === "error" && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/40">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">
              {txError === "rejected" ? "Transaction rejected in wallet." : "Network error — please try again."}
            </p>
            <button type="button" onClick={onReset} className="mt-1 text-xs text-red-500 underline hover:text-red-700">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Submit button */}
      {txStatus !== "success" && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={isBusy || !isWalletConnected || !hasAmounts}
          className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {!isWalletConnected
            ? "Connect wallet to continue"
            : txStatus === "signing"
            ? "Waiting for signature…"
            : txStatus === "submitting"
            ? "Submitting transaction…"
            : "Add liquidity"}
        </button>
      )}
    </div>
  );
}

function Row({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={`font-medium text-zinc-700 dark:text-zinc-300 tabular-nums ${valueClassName ?? ""}`}>{value}</span>
    </div>
  );
}
