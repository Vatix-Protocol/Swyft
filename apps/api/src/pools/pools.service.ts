import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CacheService, TTL } from '../cache/cache.service';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';
import { PoolListQuery, PoolOrderBy, PoolSnapshot } from './pool.types';
import { PoolsRepository, TickData } from './pools.repository';

interface PoolsListResponse {
  items: Array<{
    id: string;
    token0: string;
    token1: string;
    feeTier: string;
    tvl: number;
    volume24h: number;
    feeApr: number;
    currentPrice: number;
  }>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  orderBy: PoolOrderBy;
  search?: string;
}
export interface PoolDetail {
  id: string;
  token0: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  feeTier: number;
  currentSqrtPrice: string;
  currentTick: number;
  totalLiquidity: string;
  tvl: string;
  volume24h: string;
  volume7d: string;
  feeApr: string;
  creationTimestamp: number;
  recentSwaps: Swap[];
}

export interface Swap {
  id: string;
  timestamp: number;
  token0Amount: string;
  token1Amount: string;
  price: string;
  type: 'buy' | 'sell';
  txHash: string;
}

/**
 * Q64.96 fixed-point helpers for concentrated-liquidity (CL) swap math.
 *
 * A CL pool's price is stored as sqrtPriceX96 = sqrt(price) * 2^96, an
 * unsigned 160-bit fixed-point number with 96 fractional bits. All swap
 * math must be performed on these integers to avoid precision loss; the
 * helpers below are the single source of truth for conversions and for
 * the tick <-> sqrtPriceX96 relationship defined in CONTRACTS.md.
 */
export const Q96 = 1n << 96n;
const Q96_NUM = 2 ** 96;
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/** Stable error codes for CL swap math failures (fail-closed). */
export const ClSwapErrorCode = {
  INVALID_SQRT_PRICE: 'CL_INVALID_SQRT_PRICE',
  INVALID_TICK: 'CL_INVALID_TICK',
  TICK_OUT_OF_RANGE: 'CL_TICK_OUT_OF_RANGE',
  PRICE_OUT_OF_BOUNDS: 'CL_PRICE_OUT_OF_BOUNDS',
  INVALID_LIQUIDITY: 'CL_INVALID_LIQUIDITY',
  INVALID_AMOUNT: 'CL_INVALID_AMOUNT',
  ZERO_LIQUIDITY: 'CL_ZERO_LIQUIDITY',
  INVALID_TICK_SPACING: 'CL_INVALID_TICK_SPACING',
  TICK_NOT_ALIGNED: 'CL_TICK_NOT_ALIGNED',
} as const;
export type ClSwapErrorCode =
  (typeof ClSwapErrorCode)[keyof typeof ClSwapErrorCode];

export class ClSwapMathError extends Error {
  constructor(
    readonly code: ClSwapErrorCode,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ClSwapMathError';
  }
}

/**
 * Validate a pool's tick spacing. Tick spacing must be a positive integer
 * and must evenly divide the full tick range so that every aligned tick
 * stays within [MIN_TICK, MAX_TICK]. Fails closed on invalid spacing.
 */
export function assertValidTickSpacing(
  tickSpacing: number,
  correlationId?: string,
): void {
  if (
    !Number.isInteger(tickSpacing) ||
    tickSpacing <= 0 ||
    tickSpacing > MAX_TICK - MIN_TICK
  ) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_TICK_SPACING,
      `tickSpacing ${tickSpacing} must be a positive integer within the tick range`,
      correlationId,
    );
  }
}

/**
 * Assert that a tick is aligned to the pool's tick spacing. Untrusted
 * clients must not be able to supply misaligned ticks that would let them
 * bypass the pool's initialized-tick policy.
 */
export function assertTickAligned(
  tick: number,
  tickSpacing: number,
  correlationId?: string,
): void {
  assertValidTickSpacing(tickSpacing, correlationId);
  if (!Number.isInteger(tick) || tick % tickSpacing !== 0) {
    throw new ClSwapMathError(
      ClSwapErrorCode.TICK_NOT_ALIGNED,
      `tick ${tick} is not aligned to tickSpacing ${tickSpacing}`,
      correlationId,
    );
  }
}

/**
 * Enforce the pool's price range bounds: a tick must be aligned to the
 * pool's tick spacing and lie within [minTick, maxTick], which themselves
 * must be aligned and within the global [MIN_TICK, MAX_TICK] range.
 * Deny-by-default: any violation throws a typed, stable error code.
 */
export function assertTickInBounds(
  tick: number,
  tickSpacing: number,
  minTick: number = MIN_TICK,
  maxTick: number = MAX_TICK,
  correlationId?: string,
): void {
  assertTickAligned(tick, tickSpacing, correlationId);
  if (
    !Number.isInteger(minTick) ||
    !Number.isInteger(maxTick) ||
    minTick < MIN_TICK ||
    maxTick > MAX_TICK ||
    minTick >= maxTick
  ) {
    throw new ClSwapMathError(
      ClSwapErrorCode.TICK_OUT_OF_RANGE,
      `pool tick range [${minTick}, ${maxTick}] is invalid`,
      correlationId,
    );
  }
  assertTickAligned(minTick, tickSpacing, correlationId);
  assertTickAligned(maxTick, tickSpacing, correlationId);
  if (tick < minTick || tick > maxTick) {
    throw new ClSwapMathError(
      ClSwapErrorCode.TICK_OUT_OF_RANGE,
      `tick ${tick} outside pool range [${minTick}, ${maxTick}]`,
      correlationId,
    );
  }
}

/**
 * Convert a Q64.96 sqrt price to a JS number (display only).
 * Throws on non-positive or out-of-bounds values so callers fail closed.
 */
export function sqrtPriceX96ToNumber(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_SQRT_PRICE,
      'sqrtPriceX96 must be positive',
    );
  }
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
    throw new ClSwapMathError(
      ClSwapErrorCode.PRICE_OUT_OF_BOUNDS,
      'sqrtPriceX96 outside [MIN_SQRT_RATIO, MAX_SQRT_RATIO]',
    );
  }
  return Number(sqrtPriceX96) / Q96_NUM;
}

/** Convert a Q64.96 sqrt price to the human price (token1 per token0). */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const sqrtPrice = sqrtPriceX96ToNumber(sqrtPriceX96);
  return sqrtPrice * sqrtPrice;
}

/**
 * Derive the tick index from a Q64.96 sqrt price using the exact
 * tick = floor(log_{1.0001}(price)) relationship. Validates bounds.
 */
export function tickFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const price = sqrtPriceX96ToPrice(sqrtPriceX96);
  const tick = Math.floor(Math.log(price) / Math.log(1.0001));
  if (!Number.isFinite(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new ClSwapMathError(
      ClSwapErrorCode.TICK_OUT_OF_RANGE,
      `derived tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`,
    );
  }
  return tick;
}

/**
 * Compute the Q64.96 sqrt price for a tick. Used to validate that a
 * stored currentTick and currentSqrtPrice are consistent.
 */
export function sqrtPriceX96FromTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_TICK,
      `tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`,
    );
  }
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  return BigInt(Math.round(sqrtPrice * Q96_NUM));
}

/**
 * Validate that a pool's stored currentTick matches its currentSqrtPrice.
 * A mismatch means the on-chain state and the indexed state have drifted;
 * callers must fail closed rather than serve inconsistent swap math.
 */
export function assertTickMatchesSqrtPrice(
  tick: number,
  sqrtPriceX96: bigint,
  correlationId?: string,
): void {
  const derived = tickFromSqrtPriceX96(sqrtPriceX96);
  if (derived !== tick) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_TICK,
      `currentTick ${tick} does not match currentSqrtPrice (derived ${derived})`,
      correlationId,
    );
  }
}

/**
 * Compute the amount of token0 required to move from sqrtPriceA to
 * sqrtPriceB given liquidity L, per the CL swap invariant:
 *   amount0 = L * (sqrtB - sqrtA) / (sqrtA * sqrtB)
 * All inputs are Q64.96 integers; the result is rounded up (ceil) so the
 * pool never under-charges the swapper.
 */
export function amount0Delta(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint,
): bigint {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_LIQUIDITY,
      'liquidity must be positive',
    );
  }
  const [lo, hi] = sqrtPriceA < sqrtPriceB
    ? [sqrtPriceA, sqrtPriceB]
    : [sqrtPriceB, sqrtPriceA];
  if (lo <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_SQRT_PRICE,
      'sqrt price must be positive',
    );
  }
  const numerator = liquidity * (hi - lo) * Q96;
  const denominator = hi * lo;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Compute the amount of token1 required to move from sqrtPriceA to
 * sqrtPriceB given liquidity L, per the CL swap invariant:
 *   amount1 = L * (sqrtB - sqrtA) / Q96
 * Rounded up (ceil) so the pool never under-charges the swapper.
 */
export function amount1Delta(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint,
): bigint {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_LIQUIDITY,
      'liquidity must be positive',
    );
  }
  const [lo, hi] = sqrtPriceA < sqrtPriceB
    ? [sqrtPriceA, sqrtPriceB]
    : [sqrtPriceB, sqrtPriceA];
  const numerator = liquidity * (hi - lo);
  return (numerator + Q96 - 1n) / Q96;
}

/**
 * Compute the next sqrt price after swapping a given amount of token0
 * into the pool, bounded by the target sqrt price. Returns the new sqrt
 * price and the amount actually consumed (<= amountIn).
 */
export function nextSqrtPriceFromAmount0(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  targetSqrtPriceX96: bigint,
): { sqrtPriceX96: bigint; amountIn: bigint } {
  if (amountIn <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_AMOUNT,
      'amountIn must be positive',
    );
  }
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.ZERO_LIQUIDITY,
      'cannot swap with zero liquidity',
    );
  }
  const numerator = liquidity * Q96;
  const denominator = numerator + amountIn * sqrtPriceX96;
  const next = (numerator * sqrtPriceX96) / denominator;
  if (next <= targetSqrtPriceX96) {
    return { sqrtPriceX96: targetSqrtPriceX96, amountIn };
  }
  const consumed = amount0Delta(next, sqrtPriceX96, liquidity);
  return { sqrtPriceX96: next, amountIn: consumed };
}

/**
 * Compute the next sqrt price after swapping a given amount of token1
 * into the pool, bounded by th

/* … truncated 4014 chars — edit only what you need near the top … */
