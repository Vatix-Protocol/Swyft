"use client";

import Link from "next/link";
import { PositionRangeBadge } from "@swyft/ui";
import type { PositionSnapshot } from "@swyft/ui";

function rangeStatus(p: PositionSnapshot): "in-range" | "out-of-range" | "closed" {
  if (p.status === "closed") return "closed";
  const lower = Math.pow(1.0001, p.lowerTick);
  const upper = Math.pow(1.0001, p.upperTick);
  return p.poolCurrentPrice >= lower && p.poolCurrentPrice <= upper ? "in-range" : "out-of-range";
}

function shortSymbol(id: string) {
  return id.length > 8 ? `${id.slice(0, 4)}…` : id;
}

interface Props {
  position: PositionSnapshot;
  onCollectFees: (id: string) => void;
  collecting: boolean;
}

export function PositionCard({ position: p, onCollectFees, collecting }: Props) {
  const rs = rangeStatus(p);
  const t0 = shortSymbol(p.token0);
  const t1 = shortSymbol(p.token1);
  const lowerPrice = Math.pow(1.0001, p.lowerTick).toFixed(6);
  const upperPrice = Math.pow(1.0001, p.upperTick).toFixed(6);
  const fees0 = parseFloat(p.uncollectedFeesToken0);
  const fees1 = parseFloat(p.uncollectedFeesToken1);
  const hasFees = fees0 > 0 || fees1 > 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
            {t0} / {t1}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {lowerPrice} – {upperPrice}
          </p>
        </div>
        <PositionRangeBadge status={rs} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5">
          <p className="text-xs text-zinc-400 mb-0.5">Value</p>
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
            ${p.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2.5">
          <p className="text-xs text-indigo-400 mb-0.5">Uncollected fees</p>
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 tabular-nums">
            {fees0.toFixed(4)} {t0}
          </p>
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 tabular-nums">
            {fees1.toFixed(4)} {t1}
          </p>
        </div>
      </div>

      {/* Actions */}
      {p.status === "active" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onCollectFees(p.id)}
            disabled={collecting || !hasFees}
            className="flex-1 min-h-[44px] rounded-xl bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {collecting ? "Collecting…" : "Collect fees"}
          </button>
          <Link
            href={`/pools/${p.poolId}/add?positionId=${p.id}`}
            className="flex-1 min-h-[44px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-center"
          >
            Add
          </Link>
          <Link
            href={`/positions/${p.id}/remove`}
            className="flex-1 min-h-[44px] flex items-center justify-center rounded-xl border border-red-200 dark:border-red-900 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-center"
          >
            Remove
          </Link>
        </div>
      )}

      {p.status === "closed" && p.closedAt && (
        <p className="text-xs text-zinc-400">
          Closed {new Date(p.closedAt * 1000).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
