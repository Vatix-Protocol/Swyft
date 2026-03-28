import { Injectable, Logger } from '@nestjs/common';
import { CacheService, TTL } from '../cache/cache.service';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';
import { PoolListQuery, PoolOrderBy, PoolSnapshot } from './pool.types';
import { PoolsRepository } from './pools.repository';

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
    // This is a mock implementation - in production this would query the database
    // For now, we'll return mock data that matches the expected structure
    
    // Check if ID looks like a valid pool identifier (cuid or contract address)
    if (!this.isValidPoolId(id)) {
      return null;
    }

    // Mock pool data - replace with actual database query
    const mockPool: PoolDetail = {
      id,
      token0: {
        address: '0x1234567890123456789012345678901234567890',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      },
      token1: {
        address: '0x0987654321098765432109876543210987654321',
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
      },
      feeTier: 3000, // 0.3%
      currentSqrtPrice: '202918467837465283647382910',
      currentTick: -276324,
      totalLiquidity: '15000000000000000000',
      tvl: '45000000.00',
      volume24h: '1250000.00',
      volume7d: '8750000.00',
      feeApr: '0.0234', // 2.34%
      creationTimestamp: 1709856000, // March 8, 2024
      recentSwaps: this.generateMockSwaps(id),
    };

    return mockPool;
  }

  private isValidPoolId(id: string): boolean {
    // Basic validation - check if it's a cuid or contract address
    // CUID pattern: starts with 'c' followed by alphanumeric characters, length ~25
    const cuidPattern = /^c[a-z0-9]{24}$/;
    // Contract address pattern: 0x followed by 40 hex characters
    const addressPattern = /^0x[a-fA-F0-9]{40}$/;
    
    return cuidPattern.test(id) || addressPattern.test(id);
  }

  private generateMockSwaps(poolId: string): Swap[] {
    const swaps: Swap[] = [];
    const now = Date.now();
    
    for (let i = 0; i < 10; i++) {
      swaps.push({
        id: `swap_${poolId}_${i}`,
        timestamp: now - (i * 60000), // Each swap 1 minute apart
        token0Amount: (Math.random() * 10000).toFixed(6),
        token1Amount: (Math.random() * 5).toFixed(6),
        price: (2000 + Math.random() * 100).toFixed(2),
        type: Math.random() > 0.5 ? 'buy' : 'sell',
        txHash: `0x${Math.random().toString(16).substr(2, 64)}`,
      });
    }
    
    return swaps;
  }

  async invalidatePoolCache(poolId: string): Promise<void> {
    await this.cacheService.invalidate(`pool:${poolId}`);
  }
}

export type { PoolsListResponse };
