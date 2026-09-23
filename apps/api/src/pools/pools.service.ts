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
  roundUp: boolean,
): bigint {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_LIQUIDITY,
      'liquidity must be positive',
    );
  }
  if (sqrtPriceA <= 0n || sqrtPriceB <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_SQRT_PRICE,
      'sqrt prices must be positive',
    );
  }
  const [lower, upper] =
    sqrtPriceA < sqrtPriceB
      ? [sqrtPriceA, sqrtPriceB]
      : [sqrtPriceB, sqrtPriceA];
  const numerator = liquidity * (upper - lower) * Q96;
  const denominator = upper * lower;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (roundUp && remainder > 0n) {
    return quotient + 1n;
  }
  return quotient;
}

/**
 * Compute the amount of token1 required to move from sqrtPriceA to
 * sqrtPriceB given liquidity L, per the CL swap invariant:
 *   amount1 = L * (sqrtB - sqrtA) / Q96
 * All inputs are Q64.96 integers; the result is rounded up (ceil) so the
 * pool never under-charges the swapper.
 */
export function amount1Delta(
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_LIQUIDITY,
      'liquidity must be positive',
    );
  }
  if (sqrtPriceA <= 0n || sqrtPriceB <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_SQRT_PRICE,
      'sqrt prices must be positive',
    );
  }
  const [lower, upper] =
    sqrtPriceA < sqrtPriceB
      ? [sqrtPriceA, sqrtPriceB]
      : [sqrtPriceB, sqrtPriceA];
  const numerator = liquidity * (upper - lower);
  const quotient = numerator / Q96;
  const remainder = numerator % Q96;
  if (roundUp && remainder > 0n) {
    return quotient + 1n;
  }
  return quotient;
}

/**
 * Compute the next sqrt price after swapping a given amount of token0
 * into the pool, per the CL invariant:
 *   sqrtPriceNext = (L * sqrtPriceCurrent * Q96) / (L * Q96 + amount0In * sqrtPriceCurrent)
 * Fails closed on non-positive liquidity or amount.
 */
export function nextSqrtPriceFromAmount0In(
  sqrtPriceCurrent: bigint,
  liquidity: bigint,
  amount0In: bigint,
): bigint {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_LIQUIDITY,
      'liquidity must be positive',
    );
  }
  if (amount0In <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_AMOUNT,
      'amount0In must be positive',
    );
  }
  const numerator = liquidity * sqrtPriceCurrent * Q96;
  const denominator = liquidity * Q96 + amount0In * sqrtPriceCurrent;
  return numerator / denominator;
}

/**
 * Compute the next sqrt price after swapping a given amount of token1
 * into the pool, per the CL invariant:
 *   sqrtPriceNext = sqrtPriceCurrent + (amount1In * Q96) / L
 * Fails closed on non-positive liquidity or amount.
 */
export function nextSqrtPriceFromAmount1In(
  sqrtPriceCurrent: bigint,
  liquidity: bigint,
  amount1In: bigint,
): bigint {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_LIQUIDITY,
      'liquidity must be positive',
    );
  }
  if (amount1In <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_AMOUNT,
      'amount1In must be positive',
    );
  }
  return sqrtPriceCurrent + (amount1In * Q96) / liquidity;
}

/**
 * Compute the amount of token0 out for a given amount of token1 in,
 * bounded by the target sqrt price. Used for exact-output swaps.
 */
export function amount0OutFromAmount1In(
  sqrtPriceCurrent: bigint,
  sqrtPriceTarget: bigint,
  liquidity: bigint,
): bigint {
  return amount0Delta(sqrtPriceCurrent, sqrtPriceTarget, liquidity, false);
}

/**
 * Compute the amount of token1 out for a given amount of token0 in,
 * bounded by the target sqrt price. Used for exact-output swaps.
 */
export function amount1OutFromAmount0In(
  sqrtPriceCurrent: bigint,
  sqrtPriceTarget: bigint,
  liquidity: bigint,
): bigint {
  return amount1Delta(sqrtPriceCurrent, sqrtPriceTarget, liquidity, false);
}

/**
 * Validate a CL pool's liquidity is positive. Zero liquidity means the
 * pool cannot price swaps; callers must fail closed rather than divide
 * by zero or serve a meaningless price.
 */
export function assertPositiveLiquidity(
  liquidity: bigint,
  correlationId?: string,
): void {
  if (liquidity <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.ZERO_LIQUIDITY,
      'pool liquidity must be positive',
      correlationId,
    );
  }
}

/**
 * Validate a swap amount is positive. Zero or negative amounts are
 * rejected so untrusted clients cannot grief the pool with no-op swaps.
 */
export function assertPositiveAmount(
  amount: bigint,
  correlationId?: string,
): void {
  if (amount <= 0n) {
    throw new ClSwapMathError(
      ClSwapErrorCode.INVALID_AMOUNT,
      'swap amount must be positive',
      correlationId,
    );
  }
}

/**
 * Single source of truth for CL pool state.
 *
 * Per CONTRACTS.md, the `pool` record (as returned by PoolsRepository) is
 * authoritative for liquidity, price, and tick state. The `cl-pool` view
 * is a *derived* projection of that record and MUST NOT be treated as an
 * independent authority. This helper builds the derived CL view from the
 * pool SoT so that every consumer reads the same numbers.
 */
export interface ClPoolDerivedView {
  poolId: string;
  currentSqrtPrice: string;
  currentTick: number;
  totalLiquidity: string;
  tickSpacing: number;
  minTick: number;
  maxTick: number;
}

export function deriveClPoolView(pool: {
  id: string;
  currentSqrtPrice: string;
  currentTick: number;
  totalLiquidity: string;
  tickSpacing: number;
  minTick: number;
  maxTick: number;
}): ClPoolDerivedView {
  return {
    poolId: pool.id,
    currentSqrtPrice: pool.currentSqrtPrice,
    currentTick: pool.currentTick,
    totalLiquidity: pool.totalLiquidity,
    tickSpacing: pool.tickSpacing,
    minTick: pool.minTick,
    maxTick: pool.maxTick,
  };
}

@Injectable()
export class PoolsService {
  private readonly logger = new Logger(PoolsService.name);

  constructor(
    private readonly poolsRepository: PoolsRepository,
    private readonly cacheService: CacheService,
  ) {}

  async listPools(query: GetPoolsQueryDto): Promise<PoolsListResponse> {
    const cacheKey = `pools:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get<PoolsListResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const listQuery: PoolListQuery = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      orderBy: query.orderBy ?? PoolOrderBy.TVL,
      search: query.search?.trim() || undefined,
      token0: query.token0?.trim() || undefined,
      token1: query.token1?.trim() || undefined,
      includeInactive: query.includeInactive === true,
    };

    const { items, total } = await this.poolsRepository.listPools(listQuery);
    const totalPages = Math.ceil(total / listQuery.limit);

    const response: PoolsListResponse = {
      items: items.map((pool) => ({
        id: pool.id,
        token0: pool.token0,
        token1: pool.token1,
        feeTier: pool.feeTier,
        tvl: pool.tvl,
        volume24h: pool.volume24h,
        feeApr: pool.feeApr,
        currentPrice: pool.currentPrice,
      })),
      page: listQuery.page,
      limit: listQuery.limit,
      total,
      totalPages,
      orderBy: listQuery.orderBy,
      search: listQuery.search,
    };

    await this.cacheService.set(cacheKey, response, TTL.SHORT);
    return response;
  }

  async getPoolDetail(id: string): Promise<PoolDetail> {
    const cacheKey = `pools:detail:${id}`;
    const cached = await this.cacheService.get<PoolDetail>(cacheKey);
    if (cached) {
      return cached;
    }

    const pool = await this.poolsRepository.getPoolById(id);
    if (!pool) {
      throw new NotFoundException(`Pool ${id} not found`);
    }

  private getListCacheKey(query: PoolListQuery): string {
    return [
      'pools:list:v1',
      `page=${query.page}`,
      `limit=${query.limit}`,
      `orderBy=${query.orderBy}`,
      `search=${query.search ?? ''}`,
      `token0=${query.token0 ?? ''}`,
      `token1=${query.token1 ?? ''}`,
      `includeInactive=${query.includeInactive === true}`,
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
      currentSqrtPrice: pool.currentSqrtPrice,
      currentTick: pool.currentTick,
      totalLiquidity: pool.totalLiquidity,
      tvl: pool.tvl,
      volume24h: pool.volume24h,
      volume7d: pool.volume7d,
      feeApr: pool.feeApr,
      creationTimestamp: pool.creationTimestamp,
      recentSwaps: pool.recentSwaps,
    };
  }
      id: pool.id,
      token0: pool.token0,
      token1: pool.token1,
      feeTier: pool.feeTier,
      currentSqrtPrice: pool.currentSqrtPrice,
      currentTick: pool.currentTick,
      totalLiquidity: pool.totalLiquidity,
      tvl: pool.tvl,
      volume24h: pool.volume24h,
      volume7d: pool.volume7d,
      feeApr: pool.feeApr,
      creationTimestamp: pool.creationTimestamp,
      recentSwaps: pool.recentSwaps,
    };

    await this.cacheService.set(cacheKey, detail, TTL.SHORT);
    return detail;
  }

  /**
   * Return the derived CL view for a pool. The pool record is the single
   * source of truth; this method never reads an independent cl-pool store.
   */
  async getClPoolView(id: string): Promise<ClPoolDerivedView> {
    const pool = await this.poolsRepository.getPoolById(id);
    if (!pool) {
      throw new NotFoundException(`Pool ${id} not found`);
    }
    return deriveClPoolView(pool);
  }

  async findPoolById(id: string): Promise<PoolDetail | null> {
    const data = await this.poolsRepository.getPoolDetailById(id);
    if (!data) return null;

    const { pool, token0, token1 } = data;

    return {
      id: pool.id,
      token0: {
        address: pool.token0Address,
        symbol: token0?.symbol ?? '',
        name: token0?.name ?? '',
        decimals: token0?.decimals ?? 18,
      },
      token1: {
        address: pool.token1Address,
        symbol: token1?.symbol ?? '',
        name: token1?.name ?? '',
        decimals: token1?.decimals ?? 18,
      },
      feeTier: pool.feeTier,
      currentSqrtPrice: pool.currentSqrtPrice,
      currentTick: pool.currentTick,
      totalLiquidity: pool.liquidity,
      tvl: pool.tvl,
      volume24h: pool.volume24h,
      volume7d: '0',
      feeApr: pool.feeApr,
      creationTimestamp: Math.floor(pool.createdAt.getTime() / 1000),
      recentSwaps: pool.swaps.map(
        (swap: {
          id: string;
          amount0: string | null;
          amount1: string | null;
          timestamp: Date;
          transactionHash: string;
        }) => {
          const a0 = Number.parseFloat(swap.amount0 ?? '0');
          const a1 = Number.parseFloat(swap.amount1 ?? '0');
          const price = a1 !== 0 ? (a0 / a1).toString() : a0.toString();

          return {
            id: swap.id,
            timestamp: Math.floor(swap.timestamp.getTime() / 1000),
            token0Amount: swap.amount0,
            token1Amount: swap.amount1,
            price,
            type: a0 > a1 ? 'sell' : 'buy',
            txHash: swap.transactionHash,
          };
        },
      ),
    };
  }
  }

  async getTicks(id: string): Promise<TickData[]> {
    const pool = await this.poolsRepository.getPoolById(id);
    if (!pool) {
      throw new NotFoundException(`Pool ${id} not found`);
    }
    return this.poolsRepository.getTicks(id);
  }
}
