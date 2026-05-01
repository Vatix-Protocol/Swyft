"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { TokenLogo } from "@swyft/ui";
import { usePools, PoolOrderBy, PoolListItem } from "@/hooks/usePools";
import type { Token } from "@swyft/ui";

function fmt(n: number, prefix = "$") {
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(2)}K`;
  return `${prefix}${n.toFixed(2)}`;
}

function fmtApr(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

function fmtFee(feeTier: string) {
  const bps = Number(feeTier);
  return `${(bps / 10_000).toFixed(2)}%`;
}

function tokenFromAddress(address: string): Token {
  const symbol = address.length > 8 ? `${address.slice(0, 4)}…` : address;
  return { id: address, symbol, name: address, logoUrl: null };
}

type SortKey = "tvl" | "volume" | "apr";

const SORT_MAP: Record<SortKey, PoolOrderBy> = {
  tvl: "tvl",
  volume: "volume",
  apr: "apr",
};

export default function PoolsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("tvl");
  const [page, setPage] = useState(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  const { data, isLoading, isError } = usePools({
    page,
    orderBy: SORT_MAP[sortKey],
    search: debouncedSearch,
  });

  function handleSort(key: SortKey) {
    setSortKey(key);
    setPage(1);
  }

  function SortHeader({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <button
        onClick={() => handleSort(col)}
        className={`flex items-center gap-1 font-medium transition-colors ${
          active ? "text-indigo-500" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        }`}
      >
        {label}
        <span className="text-xs">{active ? "↓" : "↕"}</span>
      </button>
    );
  }

  function PoolRow({ pool }: { pool: PoolListItem }) {
    const t0 = tokenFromAddress(pool.token0);
    const t1 = tokenFromAddress(pool.token1);
    return (
      <tr
        onClick={() => router.push(`/pools/${pool.id}`)}
        className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 transition-colors"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              <TokenLogo token={t0} size={24} />
              <TokenLogo token={t1} size={24} />
            </div>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {t0.symbol}/{t1.symbol}
            </span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {fmtFee(pool.feeTier)}
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
          {fmt(pool.tvl)}
        </td>
        <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
          {fmt(pool.volume24h)}
        </td>
        <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
          {fmt(pool.volume7d)}
        </td>
        <td className="px-4 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">
          {fmtApr(pool.feeApr)}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/pools/${pool.id}/add-liquidity`);
            }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Add liquidity
          </button>
        </td>
      </tr>
    );
  }

  const pools = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Pools</h1>
        <input
          type="search"
          placeholder="Search by token symbol…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-72"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-3 text-left text-zinc-500 font-medium">Pool</th>
              <th className="px-4 py-3 text-right">
                <SortHeader label="TVL" col="tvl" />
              </th>
              <th className="px-4 py-3 text-right">
                <SortHeader label="24h Volume" col="volume" />
              </th>
              <th className="px-4 py-3 text-right text-zinc-500 font-medium">7d Volume</th>
              <th className="px-4 py-3 text-right">
                <SortHeader label="Fee APR" col="apr" />
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-400">
                  Loading pools…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-red-500">
                  Failed to load pools. Please try again.
                </td>
              </tr>
            )}
            {!isLoading && !isError && pools.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-400">
                  {debouncedSearch
                    ? `No pools found matching "${debouncedSearch}".`
                    : "No pools available yet."}
                </td>
              </tr>
            )}
            {pools.map((pool) => (
              <PoolRow key={pool.id} pool={pool} />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
