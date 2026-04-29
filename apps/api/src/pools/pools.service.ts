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

    const { items, total } = await this.poolsRepository.listActivePools(normalized);
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

  private toResponsePool(pool: PoolSnapshot): PoolsListResponse['items'][number] {
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

  async invalidatePoolCache(poolId: string): Promise<void> {
    await this.cache.invalidate(`pool:${poolId}`);
  }

  async getPoolTicks(poolId: string, query: GetTicksQueryDto): Promise<TickData[]> {
    // Build cache key with optional filters
    const cacheKey = this.getTicksCacheKey(poolId, query);
    
    // Try to get from cache first
    const cached = await this.cache.get<TickData[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Build query for repository
    const queryInput: GetTicksQuery = {
      poolId,
      lowerTick: query.lowerTick,
      upperTick: query.upperTick,
    };

    // Fetch from database
    const ticks = await this.poolsRepository.getTicks(queryInput);

    // Cache the result - ticks data should be cached longer since it updates less frequently
    // Cache for 5 minutes (300 seconds)
    await this.cache.set(cacheKey, ticks, 300);

    return ticks;
  }

  private getTicksCacheKey(poolId: string, query: GetTicksQueryDto): string {
    return [
      'pool:ticks:v1',
      `poolId=${poolId}`,
      `lower=${query.lowerTick ?? 'none'}`,
      `upper=${query.upperTick ?? 'none'}`,
    ].join(':');
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

    const ticks = await this.poolsRepository.getTicksByPoolId(poolId, lowerTick, upperTick);
    await this.cache.set(cacheKey, ticks, TTL.TICKS);
    return ticks;
  }

  async invalidatePoolCache(poolId: string): Promise<void> {
    await this.cache.invalidate(`pool:${poolId}`);
    await this.cache.invalidatePattern(`pool:${poolId}:ticks:*`);
  }
}

export type { PoolsListResponse };
