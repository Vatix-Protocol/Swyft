"use client";

import { useEffect, useRef } from "react";
import type { SwapQuote } from "@swyft/sdk";
import type { Token } from "@swyft/ui";
import { PriceImpactBadge } from "@swyft/ui";
import { useSwapExecution } from "@/hooks/useSwapExecution";
import { explorerTxUrl } from "@/lib/constants";

interface Props {
  poolId: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  quote: SwapQuote;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function SwapConfirmModal({
  poolId,
  tokenIn,
  tokenOut,
  amountIn,
  quote,
  walletAddress,
  onClose,
  onSuccess,
}: Props) {
  const { status, error, txHash, execute, reset } = useSwapExecution();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Trap focus / close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && status === "idle") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [status, onClose]);

  // Notify parent after success so it can refresh tx history
  useEffect(() => {
    if (status === "success") onSuccess();
  }, [status, onSuccess]);

  const isBusy = status === "signing" || status === "submitting";

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current && !isBusy) onClose();
  }

  function handleConfirm() {
    execute({ poolId, tokenIn, tokenOut, amountIn, quote, walletAddress });
  }

  function handleRetry() {
    reset();
    execute({ poolId, tokenIn, tokenOut, amountIn, quote, walletAddress });
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm swap"
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
            {status === "success" ? "Swap confirmed" : "Confirm swap"}
          </h2>
          {!isBusy && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Token amounts */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">You pay</span>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                {parseFloat(amountIn).toFixed(6)} {tokenIn.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">You receive</span>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                ≈{parseFloat(quote.amountOut).toFixed(6)} {tokenOut.symbol}
              </span>
            </div>
          </div>

          {/* Fee breakdown */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
              <span>Rate</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                1 {tokenIn.symbol} = {parseFloat(quote.executionPrice).toFixed(6)} {tokenOut.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
              <span>Min. received</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {parseFloat(quote.minimumReceived).toFixed(6)} {tokenOut.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
              <span>Price impact</span>
              <PriceImpactBadge impact={quote.priceImpact} />
            </div>
            <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
              <span>LP fee</span>
              <span>{parseFloat(quote.lpFee).toFixed(7)} {tokenIn.symbol}</span>
            </div>
            {parseFloat(quote.protocolFee) > 0 && (
              <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
                <span>Protocol fee</span>
                <span>{parseFloat(quote.protocolFee).toFixed(7)} {tokenIn.symbol}</span>
              </div>
            )}
          </div>

          {/* Success state */}
          {status === "success" && txHash && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950">
              <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">
                Transaction submitted successfully
              </p>
              <a
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-green-600 underline hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 font-mono"
              >
                {txHash.slice(0, 8)}…{txHash.slice(-8)}
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          )}

          {/* Error states */}
          {status === "error" && error === "slippage" && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Swap failed — price moved beyond your slippage tolerance. Try increasing slippage or retry.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-2 text-xs font-semibold text-amber-700 underline hover:text-amber-900 dark:text-amber-400"
              >
                Retry
              </button>
            </div>
          )}

          {status === "error" && error === "network" && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                Network error — the transaction could not be submitted.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-2 text-xs font-semibold text-red-600 underline hover:text-red-800 dark:text-red-400"
              >
                Retry
              </button>
            </div>
          )}

          {/* Action buttons */}
          {status === "success" ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isBusy || status === "error"}
              className="w-full min-h-[44px] rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 flex items-center justify-center gap-2"
            >
              {status === "signing" && (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                  Waiting for signature…
                </>
              )}
              {status === "submitting" && (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                  Submitting…
                </>
              )}
              {(status === "idle") && "Confirm swap"}
              {status === "error" && "Failed"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
