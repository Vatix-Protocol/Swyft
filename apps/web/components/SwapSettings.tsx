'use client';

import { useState } from 'react';
import { MevToggle } from './MevToggle';

const SLIPPAGE_PRESETS = ['0.1', '0.5', '1.0'];

export function SwapSettings() {
  const [slippage, setSlippage] = useState('0.5');
  const [custom, setCustom] = useState('');

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 w-full max-w-sm shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3">
        Swap Settings
      </h2>

      {/* Slippage */}
      <div className="mb-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
          Slippage tolerance
        </p>
        <div className="flex gap-2">
          {SLIPPAGE_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setSlippage(p); setCustom(''); }}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                slippage === p && !custom
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {p}%
            </button>
          ))}
          <input
            type="number"
            min="0"
            max="50"
            step="0.1"
            placeholder="Custom"
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setSlippage(e.target.value); }}
            className="w-20 px-2 py-1 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2">
        <MevToggle />
      </div>
    </div>
  );
}
