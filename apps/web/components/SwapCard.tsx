'use client';

import { useState } from 'react';
import type { SwapQuote } from '@swyft/sdk';
import type { Token } from '@swyft/ui';
import { SwapSettings } from './SwapSettings';
import { useMevProtection } from '../hooks/useMevProtection';
import { useSwapExecution } from '../hooks/useSwapExecution';

interface SwapFormState {
  tokenIn: Token | null;
  tokenOut: Token | null;
  amountIn: string;
  quote: SwapQuote | null;
  walletAddress: string;
}

export function SwapCard() {
  const { enabled, rpcUrl } = useMevProtection();
  const [showSettings, setShowSettings] = useState(false);
  const { status, error, txHash, execute, reset } = useSwapExecution();

  const [formState] = useState<SwapFormState>({
    tokenIn: null,
    tokenOut: null,
    amountIn: '',
    quote: null,
    walletAddress: '',
  });

  const handleSwap = async () => {
    if (!formState.tokenIn || !formState.tokenOut || !formState.quote) {
      return;
    }

    const poolId = ''; // would be derived from tokenIn/tokenOut pair
    execute({
      poolId,
      tokenIn: formState.tokenIn,
      tokenOut: formState.tokenOut,
      amountIn: formState.amountIn,
      quote: formState.quote,
      walletAddress: formState.walletAddress,
    });
  };

  const isLoading = status === 'signing' || status === 'submitting';
  const hasError = status === 'error';

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {status === 'success' ? 'Swap complete' : 'Swap'}
          </h2>
          <button
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Swap settings"
            aria-expanded={showSettings}
            disabled={isLoading}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            ⚙
          </button>
        </div>

        {/* Token inputs — placeholder */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-4 text-sm text-zinc-400">
            From token…
          </div>
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-4 text-sm text-zinc-400">
            To token…
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300">
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
              aria-hidden="true"
            />
            {status === 'signing' ? 'Waiting for signature…' : 'Submitting transaction…'}
          </div>
        )}

        {/* Success state */}
        {status === 'success' && txHash && (
          <div className="mb-3 rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 px-3 py-2.5">
            <p className="text-xs font-medium text-green-700 dark:text-green-400">
              Transaction submitted successfully
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 font-mono mt-1 break-all">
              {txHash.slice(0, 8)}…{txHash.slice(-8)}
            </p>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 px-3 py-2.5">
            <p className="text-xs font-medium text-red-700 dark:text-red-400">
              {error === 'slippage'
                ? 'Swap failed — price moved beyond your slippage tolerance.'
                : 'Network error — the transaction could not be submitted.'}
            </p>
            <button
              onClick={() => { reset(); }}
              className="mt-2 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {enabled && isLoading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
            <span className="animate-pulse">●</span>
            MEV-protected endpoint active
          </div>
        )}

        <button
          onClick={() => {
            if (status === 'success') {
              reset();
            } else {
              void handleSwap();
            }
          }}
          disabled={isLoading || (!formState.tokenIn && status !== 'success')}
          className="w-full min-h-[52px] sm:min-h-[44px] rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
        >
          {status === 'success' ? 'Close' : isLoading ? 'Swapping…' : 'Swap'}
        </button>
      </div>

      {/* Settings panel — full width below the card */}
      {showSettings && (
        <div className="w-full">
          <SwapSettings />
        </div>
      )}
    </div>
  );
}
