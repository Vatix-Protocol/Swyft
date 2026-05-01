import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolsService } from '../pools/pools.service';
import { PoolsRepository } from '../pools/pools.repository';
import { CacheService } from '../cache/cache.service';
import { createMockCacheService, createMockPoolsRepository, mockTick } from './mock-factories';

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

    it('returns cached result and skips repository on cache hit', async () => {
      const cached = { items: [], page: 1, limit: 10, total: 0, totalPages: 0, orderBy: 'tvl' };
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
      // findPoolById uses isValidPoolId — cuid pattern passes
      cache.get.mockResolvedValue(null);
    });

    it('returns ticks from repository on cache miss', async () => {
      const ticks = [mockTick({ tickIndex: -100 }), mockTick({ tickIndex: 100 })];
      repo.getTicksByPoolId.mockResolvedValue(ticks);

      const result = await service.getPoolTicks(poolId);

      expect(result).toEqual(ticks);
      expect(repo.getTicksByPoolId).toHaveBeenCalledWith(poolId, undefined, undefined);
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
      await expect(service.getPoolTicks('unknown_id')).rejects.toThrow(NotFoundException);
      expect(repo.getTicksByPoolId).not.toHaveBeenCalled();
    });

    it('does not cache on 404', async () => {
      await expect(service.getPoolTicks('bad_id')).rejects.toThrow(NotFoundException);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('includes pool id in cache key', async () => {
      repo.getTicksByPoolId.mockResolvedValue([]);

      await service.getPoolTicks(poolId);

      expect(cache.get).toHaveBeenCalledWith(expect.stringContaining(poolId));
    });
  });
