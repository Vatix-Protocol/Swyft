"use client";

import { useState } from "react";

const PRESETS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
];

interface Props {
  slippageBps: number;
  onChange: (bps: number) => void;
}

export function SlippagePanel({ slippageBps, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const isPreset = PRESETS.some((p) => p.bps === slippageBps);
  const displayLabel = isPreset
    ? `${(slippageBps / 100).toFixed(1)}%`
    : `${(slippageBps / 100).toFixed(2)}%`;

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (!/^\d*\.?\d*$/.test(v)) return;
    setCustom(v);
    const num = parseFloat(v);
    if (!isNaN(num) && num > 0 && num <= 50) {
      onChange(Math.round(num * 100));
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Slippage tolerance: ${displayLabel}. Click to change.`}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:border-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        Slippage: {displayLabel}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Slippage tolerance</p>
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.bps}
                type="button"
                onClick={() => { onChange(p.bps); setCustom(""); }}
                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  slippageBps === p.bps
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Custom %"
              value={custom}
              onChange={handleCustomChange}
              aria-label="Custom slippage percentage"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <span className="text-xs text-zinc-400">%</span>
          </div>
          {slippageBps > 100 && (
            <p className="mt-1.5 text-xs text-yellow-600 dark:text-yellow-400">
              High slippage — your trade may be frontrun.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
