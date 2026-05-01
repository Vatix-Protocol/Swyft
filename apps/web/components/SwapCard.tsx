'use client';

import { useState } from 'react';
import { SwapSettings } from './SwapSettings';
import { useMevProtection } from '../hooks/useMevProtection';

export function SwapCard() {
  const { enabled, rpcUrl } = useMevProtection();
  const [submitting, setSubmitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleSwap = async () => {
    setSubmitting(true);
    try {
      // rpcUrl already resolves to protected or standard endpoint based on toggle
      console.log(`Submitting via ${enabled ? 'protected' : 'standard'} RPC: ${rpcUrl}`);
      // TODO: wire up actual swap execution with rpcUrl
      await new Promise((r) => setTimeout(r, 1500)); // placeholder
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Swap</h2>
          <button
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Swap settings"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          >
            ⚙
          </button>
        </div>

        {/* Token inputs — placeholder */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-sm text-zinc-400">
            From token…
          </div>
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-sm text-zinc-400">
            To token…
          </div>
        </div>

        {enabled && submitting && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <span className="animate-pulse">●</span>
            Submitting via MEV-protected endpoint…
          </div>
        )}

        <button
          onClick={() => void handleSwap()}
          disabled={submitting}
          className="w-full rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
        >
          {submitting ? 'Swapping…' : 'Swap'}
        </button>
      </div>

      {showSettings && <SwapSettings />}
    </div>
  );
}
