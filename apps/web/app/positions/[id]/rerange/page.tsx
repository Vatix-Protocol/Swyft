'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePosition } from '@/hooks/usePositions';
import { useRerangeLiquidity } from '@/hooks/useRerangeLiquidity';
import { PositionRangeBadge } from '@swyft/ui';

const TICK_BASE = 1.0001;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

function tickToPrice(tick: number): number {
  return Math.pow(TICK_BASE, tick);
}

function priceToTick(price: number): number {
  return Math.round(Math.log(price) / Math.log(TICK_BASE));
}

function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, rounded));
}

function feeToTickSpacing(feeTier: string): number {
  if (feeTier === '0.01%') return 1;
  if (feeTier === '0.05%') return 10;
  if (feeTier === '0.30%') return 60;
  if (feeTier === '1.00%') return 200;
  return 60;
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('swyft_auth_token');
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RerangeLiquidityPage({ params }: PageProps) {
  const { id } = use(params);
  const authToken = getAuthToken();
  const { position, loading, error } = usePosition(id, authToken);
  const { status, txError, txHash, rerange, reset } = useRerangeLiquidity(position, authToken);

  const [newLowerTick, setNewLowerTick] = useState(0);
  const [newUpperTick, setNewUpperTick] = useState(0);
  const [newLowerPrice, setNewLowerPrice] = useState('');
  const [newUpperPrice, setNewUpperPrice] = useState('');

  // Initialize tick range from position when loaded
  useEffect(() => {
    if (position) {
      // Default to current range but slightly wider
      const tickSpacing = 60; // Will be derived from pool fee tier
      const lower = nearestUsableTick(position.lowerTick - tickSpacing * 5, tickSpacing);
      const upper = nearestUsableTick(position.upperTick + tickSpacing * 5, tickSpacing);
      setNewLowerTick(lower);
      setNewUpperTick(upper);
      setNewLowerPrice(tickToPrice(lower).toFixed(6));
      setNewUpperPrice(tickToPrice(upper).toFixed(6));
    }
  }, [position]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
          aria-label="Loading position"
        />
      </div>
    );
  }

  if (error || !position) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{error ?? 'Position not found.'}</p>
        <Link href="/portfolio" className="text-sm text-indigo-600 underline hover:text-indigo-500">
          Back to portfolio
        </Link>
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2">
        <p className="text-sm text-zinc-500">Connect your wallet to manage positions.</p>
        <Link href="/" className="text-sm text-indigo-600 underline hover:text-indigo-500">
          Go home
        </Link>
      </div>
    );
  }

  const token0Symbol =
    position.token0.length > 8 ? `${position.token0.slice(0, 4)}…` : position.token0;
  const token1Symbol =
    position.token1.length > 8 ? `${position.token1.slice(0, 4)}…` : position.token1;

  const currentLowerPrice = tickToPrice(position.lowerTick).toFixed(6);
  const currentUpperPrice = tickToPrice(position.upperTick).toFixed(6);
  const newLower = tickToPrice(newLowerTick).toFixed(6);
  const newUpper = tickToPrice(newUpperTick).toFixed(6);

  const isBusy = status === 'signing' || status === 'submitting';
  const isValidRange = newLowerTick < newUpperTick;
  const hasChanged =
    newLowerTick !== position.lowerTick || newUpperTick !== position.upperTick;

  function handleLowerPriceChange(price: string) {
    setNewLowerPrice(price);
    const p = parseFloat(price);
    if (!isNaN(p) && p > 0) {
      setNewLowerTick(nearestUsableTick(priceToTick(p), 60));
    }
  }

  function handleUpperPriceChange(price: string) {
    setNewUpperPrice(price);
    const p = parseFloat(price);
    if (!isNaN(p) && p > 0) {
      setNewUpperTick(nearestUsableTick(priceToTick(p), 60));
    }
  }

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 w-full max-w-lg">
        <Link
          href="/portfolio"
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
          Portfolio
        </Link>
      </div>

      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              Rerange liquidity
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {token0Symbol} / {token1Symbol}
            </p>
          </div>
          <PositionRangeBadge
            status={
              position.poolCurrentPrice >= tickToPrice(position.lowerTick) &&
              position.poolCurrentPrice <= tickToPrice(position.upperTick)
                ? 'in-range'
                : 'out-of-range'
            }
          />
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Current range */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="mb-2 font-medium text-zinc-500 dark:text-zinc-400">Current range</p>
            <div className="flex flex-col gap-1.5 text-zinc-500 dark:text-zinc-400">
              <div className="flex justify-between">
                <span>Price range</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {currentLowerPrice} – {currentUpperPrice} {token1Symbol}/{token0Symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Position value</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  $
                  {position.currentValueUsd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* New range inputs */}
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              New price range
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Lower price</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={newLowerPrice}
                  onChange={(e) => handleLowerPriceChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Upper price</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={newUpperPrice}
                  onChange={(e) => handleUpperPriceChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Ticks: {newLowerTick} – {newUpperTick}
            </p>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="mb-2 font-medium text-zinc-500 dark:text-zinc-400">Summary</p>
            <div className="flex flex-col gap-1.5 text-zinc-500 dark:text-zinc-400">
              <div className="flex justify-between">
                <span>Action</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Remove from {currentLowerPrice}–{currentUpperPrice}, add to {newLower}–{newUpper}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Liquidity</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {position.liquidity} units
                </span>
              </div>
            </div>
          </div>

          {/* Status feedback */}
          {status === 'success' && (
            <div
              role="status"
              className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
            >
              Position reranged successfully.{' '}
              {txHash && <span className="font-mono opacity-70">{txHash.slice(0, 12)}…</span>}
            </div>
          )}

          {status === 'error' && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950"
            >
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
              <div className="flex-1">
                <p className="text-xs font-medium text-red-700 dark:text-red-400">
                  {txError === 'rejected' && 'Transaction rejected in wallet.'}
                  {txError === 'network' && 'Network error — please try again.'}
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-1 text-xs text-red-500 underline hover:text-red-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Rerange button */}
          <button
            type="button"
            onClick={() => rerange(newLowerTick, newUpperTick)}
            disabled={isBusy || !isValidRange || !hasChanged || status === 'success'}
            className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'signing' && 'Waiting for signature…'}
            {status === 'submitting' && 'Submitting…'}
            {(status === 'idle' || status === 'error') && 'Rerange liquidity'}
            {status === 'success' && 'Reranged ✓'}
          </button>
        </div>
      </div>
    </main>
  );
}
