'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePoolDetail } from '@/hooks/usePoolDetail';
import { TokenLogo } from '@swyft/ui';
import type { Token } from '@swyft/ui';

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmt(n: string | number, prefix = '$') {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (num >= 1_000_000) return `${prefix}${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${prefix}${(num / 1_000).toFixed(2)}K`;
  return `${prefix}${num.toFixed(2)}`;
}

function fmtApr(n: string | number) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return `${(num * 100).toFixed(2)}%`;
}

function fmtFee(bps: number) {
  return `${(bps / 10_000).toFixed(4)}%`;
}

function tokenToUiToken(t: { address: string; symbol: string; name: string }): Token {
  return {
    id: t.address,
    symbol: t.symbol,
    name: t.name,
    logoUrl: null,
  };
}

function PoolDetailSkeleton() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <div className="h-6 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-10 w-32 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700 mb-2" />
            <div className="h-6 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        ))}
      </div>
    </main>
  );
}

export default function PoolDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pool, isLoading, isError } = usePoolDetail(id);

  if (isLoading) return <PoolDetailSkeleton />;

  if (isError || !pool) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6">
          <Link
            href="/pools"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All Pools
          </Link>
        </div>
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
            Pool not found
          </h2>
          <p className="text-sm text-zinc-500 mb-4">
            The pool you're looking for doesn't exist or couldn't be loaded.
          </p>
          <button
            onClick={() => router.push('/pools')}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Back to pools
          </button>
        </div>
      </main>
    );
  }

  const t0 = tokenToUiToken(pool.token0);
  const t1 = tokenToUiToken(pool.token1);
  const poolName = `${pool.token0.symbol}/${pool.token1.symbol}`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/pools"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Pools
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <TokenLogo token={t0} size={32} />
            <TokenLogo token={t1} size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{poolName}</h1>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {fmtFee(pool.feeTier)} fee tier
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() =>
              router.push(`/swap?tokenIn=${pool.token0.address}&tokenOut=${pool.token1.address}`)
            }
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 transition-colors dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Swap
          </button>
          <button
            onClick={() => router.push(`/liquidity/add?poolId=${id}`)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Add liquidity
          </button>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 mb-8">
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Total Value Locked</p>
          <p className="text-lg font-semibold text-zinc-900 dark:text-white">{fmt(pool.tvl)}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">24h Volume</p>
          <p className="text-lg font-semibold text-zinc-900 dark:text-white">
            {fmt(pool.volume24h)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">7d Volume</p>
          <p className="text-lg font-semibold text-zinc-900 dark:text-white">
            {fmt(pool.volume7d)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Fee APR</p>
          <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
            {fmtApr(pool.feeApr)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Total Liquidity</p>
          <p className="text-lg font-semibold text-zinc-900 dark:text-white">
            {pool.totalLiquidity}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Current Tick</p>
          <p className="text-lg font-semibold text-zinc-900 dark:text-white">{pool.currentTick}</p>
        </div>
      </div>

      {/* Token details */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 mb-3">
            <TokenLogo token={t0} size={24} />
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white">{pool.token0.symbol}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{pool.token0.address}</p>
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pool.token0.name} • {pool.token0.decimals} decimals
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 mb-3">
            <TokenLogo token={t1} size={24} />
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white">{pool.token1.symbol}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{pool.token1.address}</p>
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pool.token1.name} • {pool.token1.decimals} decimals
          </p>
        </div>
      </div>
    </main>
  );
}
