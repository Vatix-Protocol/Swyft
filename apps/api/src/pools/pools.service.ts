import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService, TTL } from '../cache/cache.service';
import { deriveClPoolView } from './cl-pool-view';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';
import {
  ClPoolView,
  PoolListQuery,
  PoolOrderBy,
  PoolSnapshot,
} from './pool.types';
import { PoolsRepository, TickData } from './pools.repository';

export interface PoolListItem {
  id: string;
  token0: string;
  token1: string;
  feeTier: string;
  tvl: number;
  volume24h: number;
  feeApr: number;
  currentPrice: number;
  active: boolean;
}

export interface PoolsListResponse {
  items: PoolListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  orderBy: PoolOrderBy;
  search?: string;
}

export interface PoolToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
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

export interface PoolDetail {
  id: string;
  token0: PoolToken;
  token1: PoolToken;
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
  /**
   * Concentrated-liquidity state, derived from this pool record (the SoT)
   * and stamped with its provenance. Never read from a parallel cl-pool store.
   */
  clPool: ClPoolView;
}

/** Partial pool state pushed by the Horizon stream. */
export interface PoolStatePatch {
  currentPrice?: string;
}

/** Token decimals assumed when the token row has not been indexed yet. */
const DEFAULT_TOKEN_DECIMALS = 18;

@Injectable()
export class PoolsService {
  constructor(
    private readonly poolsRepository: PoolsRepository,
    private readonly cacheService: CacheService,
  ) {}

  async getPools(query: GetPoolsQueryDto): Promise<PoolsListResponse> {
    const listQuery: PoolListQuery = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      orderBy: query.orderBy ?? 'tvl',
      search: query.search?.trim() || undefined,
      token0: query.token0?.trim() || undefined,
      token1: query.token1?.trim() || undefined,
      includeInactive: query.includeInactive === true,
    };

    const cacheKey = this.getListCacheKey(listQuery);
    const cached = await this.cacheService.get<PoolsListResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const { items, total } =
      await this.poolsRepository.listActivePools(listQuery);

    const response: PoolsListResponse = {
      items: items.map((pool) => this.toListItem(pool)),
      page: listQuery.page,
      limit: listQuery.limit,
      total,
      totalPages: Math.ceil(total / listQuery.limit),
      orderBy: listQuery.orderBy,
      search: listQuery.search,
    };

    await this.cacheService.set(cacheKey, response, TTL.POOL_LIST);
    return response;
  }

  async findPoolById(id: string): Promise<PoolDetail | null> {
    const data = await this.poolsRepository.getPoolDetailById(id);
    if (!data) return null;

    const { pool, token0, token1 } = data;

    return {
      id: pool.id,
      token0: this.toPoolToken(pool.token0Address, token0),
      token1: this.toPoolToken(pool.token1Address, token1),
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
          amount0: string;
          amount1: string;
          timestamp: Date;
          transactionHash: string;
        }): Swap => {
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
      clPool: deriveClPoolView(pool),
    };
  }

  /**
   * Returns the pool's initialized ticks in ascending order, optionally
   * limited to [lowerTick, upperTick]. Throws NotFoundException for an
   * unknown pool; 404s are never cached.
   */
  async getPoolTicks(
    poolId: string,
    lowerTick?: number,
    upperTick?: number,
  ): Promise<TickData[]> {
    const cacheKey = `pools:ticks:v1:${poolId}:${lowerTick ?? ''}:${upperTick ?? ''}`;
    const cached = await this.cacheService.get<TickData[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!(await this.poolsRepository.poolExists(poolId))) {
      throw new NotFoundException(`Pool ${poolId} not found`);
    }

    const ticks = await this.poolsRepository.getTicksByPoolId(
      poolId,
      lowerTick,
      upperTick,
    );
    await this.cacheService.set(cacheKey, ticks, TTL.TICKS);
    return ticks;
  }

  /**
   * Applies a streamed pool state update to the pool SoT and drops the
   * cached pool detail so the next read reflects it.
   */
  async handlePoolStateUpdate(
    poolId: string,
    patch: PoolStatePatch,
  ): Promise<void> {
    await this.poolsRepository.upsertPoolState(poolId, patch);
    await this.cacheService.del(`pool:${poolId}`);
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

  private toListItem(pool: PoolSnapshot): PoolListItem {
    return {
      id: pool.id,
      token0: pool.token0,
      token1: pool.token1,
      feeTier: pool.feeTier,
      tvl: pool.tvl,
      volume24h: pool.volume24h,
      feeApr: pool.feeApr,
      currentPrice: pool.currentPrice,
      active: pool.active,
    };
  }

  private toPoolToken(
    address: string,
    token: { symbol: string; name: string; decimals: number } | null,
  ): PoolToken {
    return {
      address,
      symbol: token?.symbol ?? '',
      name: token?.name ?? '',
      decimals: token?.decimals ?? DEFAULT_TOKEN_DECIMALS,
    };
  }
}
