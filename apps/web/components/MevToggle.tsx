'use client';

import { useMevProtection } from '../hooks/useMevProtection';

export function MevToggle() {
  const { enabled, toggle } = useMevProtection();

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          MEV Protection
        </span>
        <span
          title="Hides your transaction details until finalized, protecting against front-running. Trade-off: slightly slower confirmation (~5–10s)."
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 text-[10px] cursor-help select-none"
          aria-label="What is MEV protection?"
        >
          ?
        </span>
      </div>

      <div className="flex items-center gap-2">
        {enabled && (
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            Active
          </span>
        )}
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => toggle(!enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500 ${
            enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
