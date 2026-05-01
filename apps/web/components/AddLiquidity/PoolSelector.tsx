"use client";

import { usePools, type PoolDetail } from "@/hooks/usePoolTicks";

interface Props {
  selected: PoolDetail | null;
  onSelect: (pool: PoolDetail) => void;
}

export function PoolSelector({ selected, onSelect }: Props) {
  const { pools, loading } = usePools();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Select pool</p>
      {loading ? (
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 flex-1 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pools.map((pool) => {
            const isSelected = selected?.id === pool.id;
            return (
              <button
                key={pool.id}
                type="button"
                onClick={() => onSelect(pool)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 dark:border-indigo-400"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-1.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-indigo-100 text-[10px] font-bold text-indigo-700 dark:border-zinc-900 dark:bg-indigo-900 dark:text-indigo-300">
                      {(pool.token0Symbol ?? pool.token0).slice(0, 2)}
                    </div>
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-violet-100 text-[10px] font-bold text-violet-700 dark:border-zinc-900 dark:bg-violet-900 dark:text-violet-300">
                      {(pool.token1Symbol ?? pool.token1).slice(0, 2)}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                      {pool.token0Symbol ?? pool.token0} / {pool.token1Symbol ?? pool.token1}
                    </p>
                    <p className="text-xs text-zinc-400">{pool.feeTier} fee</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{pool.feeApr.toFixed(1)}% APR</p>
                  <p className="text-xs text-zinc-400">${(pool.tvl / 1_000_000).toFixed(1)}M TVL</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
