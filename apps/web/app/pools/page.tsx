'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TokenLogo } from '@swyft/ui';
import { usePools, PoolOrderBy, PoolListItem } from '@/hooks/usePools';
import { useSearchDebounce } from '@/hooks/useSearchDebounce';
import type { Token } from '@swyft/ui';

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(n: number, prefix = '$') {
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

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'tvl' | 'volume' | 'apr';

const SORT_MAP: Record<SortKey, PoolOrderBy> = {
  tvl: 'tvl',
  volume: 'volume',
  apr: 'apr',
};

// ─── Skeleton row ─────────────────────────────────────────────────────────────

/**
 * A single animated skeleton row shown while pool data is loading.
 * Renders 6 cells matching the real table column layout.
 */
function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="border-b border-zinc-100 dark:border-zinc-800">
      {/* Pool name + logos */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <div className="h-6 w-6 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-6 w-6 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-10 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </td>
      {/* TVL */}
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </td>
      {/* 24h Volume */}
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </td>
      {/* 7d Volume */}
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </td>
      {/* Fee APR */}
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </td>
      {/* Action button */}
      <td className="px-4 py-3 text-right">
        <div className="ml-auto h-7 w-24 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      </td>
    </tr>
  );
}

// ─── Table sub-components ─────────────────────────────────────────────────────

function SortHeader({
  label,
  col,
  sortKey,
  isLoading,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  isLoading: boolean;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      onClick={() => onSort(col)}
      disabled={isLoading}
      aria-sort={active ? 'descending' : 'none'}
      className={`flex items-center gap-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'text-indigo-500' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
      }`}
    >
      {label}
      <span className="text-xs" aria-hidden="true">
        {active ? '↓' : '↕'}
      </span>
    </button>
  );
}

function PoolRow({ pool, onNavigate }: { pool: PoolListItem; onNavigate: (path: string) => void }) {
  const t0 = tokenFromAddress(pool.token0);
  const t1 = tokenFromAddress(pool.token1);
  return (
    <tr
      onClick={() => onNavigate(`/pools/${pool.id}`)}
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
      <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">{fmt(pool.tvl)}</td>
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
            onNavigate(`/pools/${pool.id}/add-liquidity`);
          }}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Add liquidity
        </button>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PoolsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debouncedSearch = useSearchDebounce(search);
  const [sortKey, setSortKey] = useState<SortKey>('tvl');
  const [page, setPage] = useState(1);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const { data, isLoading, isError } = usePools({
    page,
    orderBy: SORT_MAP[sortKey],
    search: debouncedSearch,
  });

  function handleSort(key: SortKey) {
    if (isLoading) return;
    setSortKey(key);
    setPage(1);
  }

  const pools = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      {/* ── Header ── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Pools</h1>
          {/* Inline spinner shown next to the heading during background refreshes */}
          {isLoading && (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
              aria-label="Loading pools"
            />
          )}
        </div>
        <input
          type="search"
          placeholder="Search by token symbol…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          disabled={isLoading}
          aria-label="Search pools"
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-72"
        />
      </div>

      {/* ── Table ── */}
      <div
        className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        aria-busy={isLoading}
        aria-live="polite"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-3 text-left text-zinc-500 font-medium">Pool</th>
              <th className="px-4 py-3 text-right">
                <SortHeader
                  label="TVL"
                  col="tvl"
                  sortKey={sortKey}
                  isLoading={isLoading}
                  onSort={handleSort}
                />
              </th>
              <th className="px-4 py-3 text-right">
                <SortHeader
                  label="24h Volume"
                  col="volume"
                  sortKey={sortKey}
                  isLoading={isLoading}
                  onSort={handleSort}
                />
              </th>
              <th className="px-4 py-3 text-right text-zinc-500 font-medium">7d Volume</th>
              <th className="px-4 py-3 text-right">
                <SortHeader
                  label="Fee APR"
                  col="apr"
                  sortKey={sortKey}
                  isLoading={isLoading}
                  onSort={handleSort}
                />
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800 animate-pulse">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                        <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                      </div>
                      <div className="h-4 w-28 rounded bg-zinc-200 dark:bg-zinc-700" />
                    </div>
                  </td>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} className="px-4 py-3 text-right">
                      <div className="ml-auto h-4 w-16 rounded bg-zinc-200 dark:bg-zinc-700" />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="ml-auto h-7 w-24 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                </tr>
              ))}
            {isError && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-red-500">
                  Failed to load pools. Please try again.
                </td>
              </tr>
            )}

            {/* Empty state */}
            {!isLoading && !isError && pools.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center">
                  {debouncedSearch ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-2xl">🔍</span>
                      <p className="font-medium text-zinc-700 dark:text-zinc-300">
                        No pools found matching &ldquo;{debouncedSearch}&rdquo;
                      </p>
                      <p className="text-sm text-zinc-400">
                        Try a different token symbol or clear the search.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-3xl">🏊</span>
                      <p className="font-semibold text-zinc-700 dark:text-zinc-300">No pools yet</p>
                      <p className="max-w-xs text-sm text-zinc-400">
                        Liquidity pools will appear here once they are created. Be the first to
                        create a pool and start earning fees.
                      </p>
                      <button
                        onClick={() => router.push('/pools/create')}
                        className="mt-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
                      >
                        Create a pool
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )}

            {/* Data rows — rendered even while a background refresh is in progress */}
            {pools.map((pool) => (
              <PoolRow key={pool.id} pool={pool} onNavigate={router.push} />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isLoading}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || isLoading}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
