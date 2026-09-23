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
 * into the pool, bounded by the target sqrt price.
 */
export function nextSqrtPriceFromAmount1(
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
  const next = sqrtPriceX96 + (amountIn * Q96) / liquidity;
  if (next >= targetSqrtPriceX96) {
    return { sqrtPriceX96: targetSqrtPriceX96, amountIn };
  }
  const consumed = amount1Delta(sqrtPriceX96, next, liquidity);
  return { sqrtPriceX96: next, amountIn: consumed };
}

@Injectable()
export class PoolsService {
  private readonly logger = new Logger(PoolsService.name);
  constructor(
    private readonly cache: CacheService,
    private readonly poolsRepository: PoolsRepository,
  ) {}

  async getPools(query: GetPoolsQueryDto): Promise<PoolsListResponse> {
    const normalized: PoolListQuery = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      orderBy: query.orderBy ?? 'tvl',
      search: query.search?.trim() || undefined,
    };

    const cacheKey = this.getListCacheKey(normalized);
    const cached = await this.cache.get<PoolsListResponse>(cacheKey);
    if (cached) return cached;

    const listResult = await this.poolsRepository.listActivePools(normalized);
    const items = Array.isArray(listResult.items) ? listResult.items : [];
    const total = Number.isFinite(listResult.total) ? listResult.total : 0;
    const response: PoolsListResponse = {
      items: items.map((pool) => this.toResponsePool(pool)),
      page: normalized.page,
      limit: normalized.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / normalized.limit),
      orderBy: normalized.orderBy,
      search: normalized.search,
    };

    await this.cache.set(cacheKey, response, TTL.POOL_LIST);
    return response;
  }

  async handlePoolStateUpdate(
    poolId: string,
    patch: { currentPrice?: string },
  ): Promise<void> {
    await this.poolsRepository.upsertPoolState(poolId, patch);
    await this.invalidateListCache();
  }

  private async invalidateListCache(): Promise<void> {
    await this.cache.invalidatePattern('pools:list:*');
  }

  private getListCacheKey(query: PoolListQuery): string {
    return [
      'pools:list:v1',
      `page=${query.page}`,
      `limit=${query.limit}`,
      `orderBy=${query.orderBy}`,
      `search=${query.search ?? ''}`,
    ].join(':');
  }

  private toResponsePool(
    pool: PoolSnapshot,
  ): PoolsListResponse['items'][number] {
    return {
      id: pool.id,
      token0: pool.token0,
      token1: pool.token1,
      feeTier: pool.feeTier,
      tvl: pool.tvl,
      volume24h: pool.volume24h,
      feeApr: pool.feeApr,
      currentPrice: pool.currentPrice,
    };
  }

  async findPoolById(id: string): Promise<PoolDetail | null> {
    const exists = await this.poolsRepository.poolExists(id);
    return exists ? ({ id } as PoolDetail) : null;
  }

  async getPoolTicks(
    poolId: string,
    lowerTick?: number,
    upperTick?: number,
  ): Promise<TickData[]> {
    const pool = await this.findPoolById(poolId);
    if (!pool) throw new NotFoundException(`Pool with ID ${poolId} not found`);

    const cacheKey = `pool:${poolId}:ticks:lower=${lowerTick ?? ''}:upper=${upperTick ?? ''}`;
    const cached = await this.cache.get<TickData[]>(cacheKey);
    if (cached) return cached;

    const ticks = await this.poolsRepository.getTicksByPoolId(
      poolId,
      lowerTick,
      upperTick,
    );
    await this.cache.set(cacheKey, ticks, TTL.TICKS);
    return ticks;
  }

  async invalidatePoolCache(poolId: string): Promise<void> {
    await this.cache.invalidate(`pool:${poolId}`);
    await this.cache.invalidatePattern(`pool:${poolId}:ticks:*`);
  }
}

export type { PoolsListResponse };
