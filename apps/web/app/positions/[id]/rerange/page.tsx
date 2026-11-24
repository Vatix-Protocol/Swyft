'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePosition } from '@/hooks/usePositions';
import { useRerangeLiquidity } from '@/hooks/useRerangeLiquidity';
import { useWalletContext } from '@/context/WalletContext';
import { PositionRangeBadge } from '@swyft/ui';
import { priceToTick } from '@/lib/position-range';

const TICK_BASE = 1.0001;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

function tickToPrice(tick: number): number {
  return Math.pow(TICK_BASE, tick);
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
  const { signTransaction } = useWalletContext();
  const { position, loading, error } = usePosition(id, authToken);
  const { status, txError, txHash, rerange, reset } = useRerangeLiquidity(
    position,
    authToken,
    signTransaction
  );

  const [newLowerTick, setNewLowerTick] = useState(0);
  const [newUpperTick, setNewUpperTick] = useState(0);
  const [newLowerPrice, setNewLowerPrice] = useState('');
  const [newUpperPrice, setNewUpperPrice] = useState('');

  // Tick spacing is derived from the position's pool fee tier via
  // feeToTickSpacing. Falls back to the 0.30% tier (spacing 60) when the
  // position carries no fee tier.
  const positionFeeTier =
    position != null
      ? (position as unknown as { feeTier?: unknown }).feeTier
      : undefined;
  const tickSpacing = feeToTickSpacing(
    typeof positionFeeTier === 'string' ? positionFeeTier : '0.30%',
  );

  // Initialize tick range from position when loaded
  useEffect(() => {
    if (position) {
      // Default to current range but slightly wider
      const lower = nearestUsableTick(position.lowerTick - tickSpacing * 5, tickSpacing);
      const upper = nearestUsableTick(position.upperTick + tickSpacing * 5, tickSpacing);
      setNewLowerTick(lower);
      setNewUpperTick(upper);
      setNewLowerPrice(tickToPrice(lower).toFixed(6));
      setNewUpperPrice(tickToPrice(upper).toFixed(6));
    }
  }, [position, tickSpacing]);

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
  const lowerTick = priceToTick(newLowerPrice);
  const upperTick = priceToTick(newUpperPrice);
  const pricesValid = lowerTick !== null && upperTick !== null;
  const isValidRange = pricesValid && lowerTick < upperTick;
  const hasChanged =
    newLowerTick !== position.lowerTick || newUpperTick !== position.upperTick;

  function handleLowerPriceChange(price: string) {
    setNewLowerPrice(price);
    const tick = priceToTick(price);
    if (tick !== null) {
      setNewLowerTick(nearestUsableTick(tick, tickSpacing));
    }
  }

  function handleUpperPriceChange(price: string) {
    setNewUpperPrice(price);
    const tick = priceToTick(price);
    if (tick !== null) {
      setNewUpperTick(nearestUsableTick(tick, tickSpacing));
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
                <label
                  htmlFor="new-lower-price"
                  className="mb-1 block text-xs text-zinc-400"
                >
                  Lower price
                </label>
                <input
                  id="new-lower-price"
                  type="text"
                  inputMode="decimal"
                  value={newLowerPrice}
                  onChange={(e) => handleLowerPriceChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label
                  htmlFor="new-upper-price"
                  className="mb-1 block text-xs text-zinc-400"
                >
                  Upper price
                </label>
                <input
                  id="new-upper-price"
                  type="text"
                  inputMode="decimal"
                  value={newUpperPrice}
                  onChange={(e) => handleUpperPriceChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  placeholder="0.00"
                />
              </div>
            </div>
            {!pricesValid && (
              <p className="mt-2 text-xs text-red-500">
                Enter valid prices for both bounds.
              </p>
            )}
            {pricesValid && !isValidRange && (
              <p className="mt-2 text-xs text-red-500">
                Lower price must be below upper price.
              </p>
            )}
          </div>

          {/* New range preview */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="mb-2 font-medium text-zinc-500 dark:text-zinc-400">New range</p>
            <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
              <span>Price range</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {newLower} – {newUpper} {token1Symbol}/{token0Symbol}
              </span>
            </div>
          </div>

          {txError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {txError}
            </p>
          )}

          {txHash && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600 dark:bg-green-900/20 dark:text-green-400">
              Rerange submitted: {txHash.slice(0, 10)}…
            </p>
          )}

          <button
            type="button"
            onClick={() => rerange(newLowerTick, newUpperTick)}
            disabled={isBusy || !isValidRange || !hasChanged}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? 'Submitting…' : 'Rerange liquidity'}
          </button>

          {status === 'success' && (
            <button
              type="button"
              onClick={reset}
              className="w-full rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Rerange again
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
