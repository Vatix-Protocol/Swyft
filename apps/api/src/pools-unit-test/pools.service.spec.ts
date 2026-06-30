import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolsService } from '../pools/pools.service';
import { PoolsRepository } from '../pools/pools.repository';
import { CacheService } from '../cache/cache.service';
import {
  createMockCacheService,
  createMockPoolsRepository,
  mockTick,
} from './mock-factories';

describe('PoolsService', () => {
  let service: PoolsService;
  let repo: ReturnType<typeof createMockPoolsRepository>;
  let cache: ReturnType<typeof createMockCacheService>;

  beforeEach(async () => {
    repo = createMockPoolsRepository();
    cache = createMockCacheService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoolsService,
        { provide: PoolsRepository, useValue: repo },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<PoolsService>(PoolsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── findAll ─────────────────────────────────────────────────────────────

  describe('getPools()', () => {
    it('returns pools from repository on cache miss', async () => {
      cache.get.mockResolvedValue(null);
      repo.listActivePools.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getPools({ page: 1, limit: 10 });

      expect(result.items).toEqual([]);
      expect(repo.listActivePools).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('passes token0 and token1 filter params to repository', async () => {
      cache.get.mockResolvedValue(null);
      repo.listActivePools.mockResolvedValue({ items: [], total: 0 });

      await service.getPools({
        page: 1,
        limit: 10,
        token0: 'USDC-addr',
        token1: 'XLM-addr',
      });

      expect(repo.listActivePools).toHaveBeenCalledWith(
        expect.objectContaining({ token0: 'USDC-addr', token1: 'XLM-addr' }),
      );
    });

    it('includes token0/token1 in cache key to isolate pair results', async () => {
      cache.get.mockResolvedValue(null);
      repo.listActivePools.mockResolvedValue({ items: [], total: 0 });

      await service.getPools({ page: 1, limit: 10, token0: 'USDC-addr' });

      expect(cache.get).toHaveBeenCalledWith(
        expect.stringContaining('token0=USDC-addr'),
      );
    });

    it('returns cached result and skips repository on cache hit', async () => {
      const cached = {
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
        orderBy: 'tvl',
      };
      cache.get.mockResolvedValue(cached);

      const result = await service.getPools({ page: 1, limit: 10 });

      expect(result).toEqual(cached);
      expect(repo.listActivePools).not.toHaveBeenCalled();
    });
  });

  // ─── getPoolTicks ─────────────────────────────────────────────────────────

  describe('getPoolTicks()', () => {
    const poolId = 'cltest123456789012345678';

    beforeEach(() => {
      cache.get.mockResolvedValue(null);
      repo.getPoolDetailById.mockResolvedValue({
        pool: {
          id: poolId,
          token0Address: '0xToken0',
          token1Address: '0xToken1',
          feeTier: 3000,
          currentSqrtPrice: '79228162514264337593543950336',
          currentTick: 0,
          liquidity: '1000000000000000000',
          tvl: '5000000',
          volume24h: '1200000',
          feeApr: '0.15',
          createdAt: new Date(),
          updatedAt: new Date(),
          swaps: [],
        },
        token0: null,
        token1: null,
      });
    });

    it('returns ticks from repository on cache miss', async () => {
      const ticks = [
        mockTick({ tickIndex: -100 }),
        mockTick({ tickIndex: 100 }),
      ];
      repo.getTicksByPoolId.mockResolvedValue(ticks);

      const result = await service.getPoolTicks(poolId);

      expect(result).toEqual(ticks);
      expect(repo.getTicksByPoolId).toHaveBeenCalledWith(
        poolId,
        undefined,
        undefined,
      );
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('returns cached ticks without hitting repository', async () => {
      const ticks = [mockTick()];
      cache.get.mockResolvedValue(ticks);

      const result = await service.getPoolTicks(poolId);

      expect(result).toEqual(ticks);
      expect(repo.getTicksByPoolId).not.toHaveBeenCalled();
    });

    it('returns empty array when pool has no initialized ticks', async () => {
      repo.getTicksByPoolId.mockResolvedValue([]);

      const result = await service.getPoolTicks(poolId);

      expect(result).toEqual([]);
    });

    it('passes lowerTick and upperTick to repository', async () => {
      repo.getTicksByPoolId.mockResolvedValue([]);

      await service.getPoolTicks(poolId, -500, 500);

      expect(repo.getTicksByPoolId).toHaveBeenCalledWith(poolId, -500, 500);
    });

    it('throws NotFoundException for unknown pool id', async () => {
      repo.poolExists.mockResolvedValue(false);
      repo.getPoolDetailById.mockResolvedValueOnce(null);
      await expect(service.getPoolTicks('unknown_id')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.getTicksByPoolId).not.toHaveBeenCalled();
    });

    it('does not cache on 404', async () => {
      repo.poolExists.mockResolvedValue(false);
      repo.getPoolDetailById.mockResolvedValueOnce(null);
      await expect(service.getPoolTicks('bad_id')).rejects.toThrow(
        NotFoundException,
      );
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('includes pool id in cache key', async () => {
      repo.getTicksByPoolId.mockResolvedValue([]);

      await service.getPoolTicks(poolId);

      expect(cache.get).toHaveBeenCalledWith(expect.stringContaining(poolId));
    });
  });

  // ─── findPoolById ────────────────────────────────────────────────────────────

  describe('findPoolById()', () => {
    const poolId = 'cltest123456789012345678';
    const now = new Date('2024-06-01T12:00:00Z');

    it('returns full PoolDetail shape for a known pool', async () => {
      const poolData = {
        pool: {
          id: poolId,
          token0Address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          token1Address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          feeTier: 3000,
          currentSqrtPrice: '79228162514264337593543950336',
          currentTick: 0,
          liquidity: '1000000000000000000',
          tvl: '5000000',
          volume24h: '1200000',
          feeApr: '0.15',
          createdAt: now,
          updatedAt: now,
          swaps: [
            {
              id: 'swap_1',
              poolId,
              senderAddress: '0xSender1',
              recipientAddress: '0xRecipient1',
              amount0: '1000000',
              amount1: '500000000000000000',
              sqrtPriceAfter: '79228162514264337593543950336',
              tickAfter: 0,
              transactionHash: '0xTxHash1',
              timestamp: now,
            },
          ],
        },
        token0: {
          id: 'tok_usdc_1',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          logoUri: null,
        },
        token1: {
          id: 'tok_eth_1',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          symbol: 'WETH',
          name: 'Wrapped Ether',
          decimals: 18,
          logoUri: null,
        },
      };

      repo.getPoolDetailById = jest.fn().mockResolvedValue(poolData);

      const result = await service.findPoolById(poolId);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('id', poolId);
      expect(result).toHaveProperty('token0.symbol', 'USDC');
      expect(result).toHaveProperty('token1.symbol', 'WETH');
      expect(result).toHaveProperty('feeTier', 3000);
      expect(result).toHaveProperty('tvl', '5000000');
      expect(result).toHaveProperty('volume24h', '1200000');
      expect(result).toHaveProperty('recentSwaps');
      expect(result?.recentSwaps).toHaveLength(1);
      expect(result?.recentSwaps[0]).toHaveProperty('txHash', '0xTxHash1');
    });

    it('returns null for unknown pool id', async () => {
      repo.getPoolDetailById = jest.fn().mockResolvedValue(null);

      const result = await service.findPoolById('unknown_id');

      expect(result).toBeNull();
    });

    it('handles missing token data with defaults', async () => {
      const poolData = {
        pool: {
          id: poolId,
          token0Address: '0xToken0',
          token1Address: '0xToken1',
          feeTier: 3000,
          currentSqrtPrice: '79228162514264337593543950336',
          currentTick: 0,
          liquidity: '1000000000000000000',
          tvl: '5000000',
          volume24h: '1200000',
          feeApr: '0.15',
          createdAt: now,
          updatedAt: now,
          swaps: [],
        },
        token0: null,
        token1: null,
      };

      repo.getPoolDetailById = jest.fn().mockResolvedValue(poolData);

      const result = await service.findPoolById(poolId);

      expect(result).toBeDefined();
      expect(result?.token0.symbol).toBe('');
      expect(result?.token0.decimals).toBe(18);
      expect(result?.token1.symbol).toBe('');
      expect(result?.token1.decimals).toBe(18);
    });
  });
});
