import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PoolsController } from './pools.controller';
import { PoolsService } from './pools.service';
import { CacheService } from '../cache/cache.service';
import { TickData } from './pool.types';

describe('PoolsController - Ticks Endpoint', () => {
  let controller: PoolsController;
  let poolsService: jest.Mocked<PoolsService>;
  let cacheService: jest.Mocked<CacheService>;

  const mockTicks: TickData[] = [
    {
      tickIndex: -276324,
      liquidityNet: '1000000000000000000',
      liquidityGross: '1000000000000000000',
      feeGrowthOutside0X128: '0',
      feeGrowthOutside1X128: '0',
    },
    {
      tickIndex: -276320,
      liquidityNet: '500000000000000000',
      liquidityGross: '1500000000000000000',
      feeGrowthOutside0X128: '100000000000000000000000000000000000',
      feeGrowthOutside1X128: '200000000000000000000000000000000000',
    },
  ];

  beforeEach(async () => {
    const mockPoolsService = {
      findPoolById: jest.fn(),
      getPoolTicks: jest.fn(),
    };

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PoolsController],
      providers: [
        { provide: PoolsService, useValue: mockPoolsService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    controller = module.get<PoolsController>(PoolsController);
    poolsService = module.get(PoolsService);
    cacheService = module.get(CacheService);
  });

  describe('GET /pools/:id/ticks', () => {
    const validPoolId = 'clx1234567890123456789012';

    it('should return ticks for valid pool', async () => {
      poolsService.findPoolById.mockResolvedValue({
        id: validPoolId,
        token0: { address: '0x123', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        token1: { address: '0x456', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        feeTier: 3000,
        currentSqrtPrice: '202918467837465283647382910',
        currentTick: -276324,
        totalLiquidity: '15000000000000000000',
        tvl: '45000000.00',
        volume24h: '1250000.00',
        volume7d: '8750000.00',
        feeApr: '0.0234',
        creationTimestamp: 1709856000,
        recentSwaps: [],
      });
      poolsService.getPoolTicks.mockResolvedValue(mockTicks);

      const result = await controller.getPoolTicks(validPoolId, {});

      expect(result).toEqual(mockTicks);
      expect(poolsService.findPoolById).toHaveBeenCalledWith(validPoolId);
      expect(poolsService.getPoolTicks).toHaveBeenCalledWith(validPoolId, {});
    });

    it('should return empty array for pool with no ticks', async () => {
      poolsService.findPoolById.mockResolvedValue({
        id: validPoolId,
        token0: { address: '0x123', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        token1: { address: '0x456', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        feeTier: 3000,
        currentSqrtPrice: '202918467837465283647382910',
        currentTick: -276324,
        totalLiquidity: '0',
        tvl: '0.00',
        volume24h: '0.00',
        volume7d: '0.00',
        feeApr: '0.0000',
        creationTimestamp: 1709856000,
        recentSwaps: [],
      });
      poolsService.getPoolTicks.mockResolvedValue([]);

      const result = await controller.getPoolTicks(validPoolId, {});

      expect(result).toEqual([]);
    });

    it('should throw NotFoundException for unknown pool', async () => {
      poolsService.findPoolById.mockResolvedValue(null);

      await expect(
        controller.getPoolTicks('unknown_pool', {})
      ).rejects.toThrow(NotFoundException);
    });

    it('should support lowerTick and upperTick filters', async () => {
      poolsService.findPoolById.mockResolvedValue({
        id: validPoolId,
        token0: { address: '0x123', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        token1: { address: '0x456', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        feeTier: 3000,
        currentSqrtPrice: '202918467837465283647382910',
        currentTick: -276324,
        totalLiquidity: '15000000000000000000',
        tvl: '45000000.00',
        volume24h: '1250000.00',
        volume7d: '8750000.00',
        feeApr: '0.0234',
        creationTimestamp: 1709856000,
        recentSwaps: [],
      });
      poolsService.getPoolTicks.mockResolvedValue([mockTicks[0]]);

      const query = { lowerTick: -276330, upperTick: -276320 };
      const result = await controller.getPoolTicks(validPoolId, query);

      expect(poolsService.getPoolTicks).toHaveBeenCalledWith(validPoolId, query);
      expect(result).toEqual([mockTicks[0]]);
    });

    it('should throw BadRequestException when lowerTick > upperTick', async () => {
      poolsService.findPoolById.mockResolvedValue({
        id: validPoolId,
        token0: { address: '0x123', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        token1: { address: '0x456', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        feeTier: 3000,
        currentSqrtPrice: '202918467837465283647382910',
        currentTick: -276324,
        totalLiquidity: '15000000000000000000',
        tvl: '45000000.00',
        volume24h: '1250000.00',
        volume7d: '8750000.00',
        feeApr: '0.0234',
        creationTimestamp: 1709856000,
        recentSwaps: [],
      });

      const query = { lowerTick: -276320, upperTick: -276330 };

      await expect(
        controller.getPoolTicks(validPoolId, query)
      ).rejects.toThrow(BadRequestException);
    });

    it('should return ticks in ascending order', async () => {
      poolsService.findPoolById.mockResolvedValue({
        id: validPoolId,
        token0: { address: '0x123', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        token1: { address: '0x456', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        feeTier: 3000,
        currentSqrtPrice: '202918467837465283647382910',
        currentTick: -276324,
        totalLiquidity: '15000000000000000000',
        tvl: '45000000.00',
        volume24h: '1250000.00',
        volume7d: '8750000.00',
        feeApr: '0.0234',
        creationTimestamp: 1709856000,
        recentSwaps: [],
      });
      poolsService.getPoolTicks.mockResolvedValue(mockTicks);

      const result = await controller.getPoolTicks(validPoolId, {});

      // Verify ticks are in ascending order
      for (let i = 1; i < result.length; i++) {
        expect(result[i].tickIndex).toBeGreaterThan(result[i - 1].tickIndex);
      }
    });
  });
});