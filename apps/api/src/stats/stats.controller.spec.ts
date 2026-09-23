import { Test, TestingModule } from '@nestjs/testing';
import { StatsController } from './stats.controller';
import { StatsService, GlobalStats } from './stats.service';
import { CacheService, TTL } from '../cache/cache.service';

const mockStats: GlobalStats = {
  totalTvl: '1000000',
  totalVolume24h: '50000',
  poolCount: 3,
  activePositions: 12,
  totalSwaps: 400,
};

describe('StatsController', () => {
  let controller: StatsController;
  let statsService: { computeGlobalStats: jest.Mock };
  let cacheService: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    statsService = { computeGlobalStats: jest.fn() };
    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [
        { provide: StatsService, useValue: statsService },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    controller = module.get<StatsController>(StatsController);
  });

  describe('getGlobalStats()', () => {
    it('computes and caches stats on a cache miss', async () => {
      cacheService.get.mockResolvedValue(null);
      statsService.computeGlobalStats.mockResolvedValue(mockStats);

      const result = await controller.getGlobalStats();

      expect(result).toEqual(mockStats);
      expect(statsService.computeGlobalStats).toHaveBeenCalledTimes(1);
      expect(cacheService.set).toHaveBeenCalledWith(
        'stats:global',
        mockStats,
        TTL.GLOBAL_STATS,
      );
    });

    it('returns the cached value on a cache hit without recomputing', async () => {
      cacheService.get.mockResolvedValue(mockStats);

      const result = await controller.getGlobalStats();

      expect(result).toEqual(mockStats);
      expect(statsService.computeGlobalStats).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('repeated calls within the TTL only hit the DB once', async () => {
      statsService.computeGlobalStats.mockResolvedValue(mockStats);

      // First call: miss — computes and populates the cache.
      cacheService.get.mockResolvedValueOnce(null);
      await controller.getGlobalStats();

      // Second call: hit — served from the now-populated cache.
      cacheService.get.mockResolvedValueOnce(mockStats);
      await controller.getGlobalStats();

      expect(statsService.computeGlobalStats).toHaveBeenCalledTimes(1);
    });
  });
});
