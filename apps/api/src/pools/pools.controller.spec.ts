import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PoolsController } from './pools.controller';
import { PoolsService } from './pools.service';
import { CacheService } from '../cache/cache.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';
import { PoolsRepository } from './pools.repository';
import {
  mockPoolDetailData,
  mockSwap,
} from '../pools-unit-test/mock-factories';

describe('PoolsController - list endpoint', () => {
  let controller: PoolsController;
  let poolsService: { getPools: jest.Mock };

  const emptyList = {
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    orderBy: 'tvl' as const,
  };

  beforeEach(async () => {
    poolsService = {
      getPools: jest.fn().mockResolvedValue(emptyList),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PoolsController],
      providers: [
        { provide: PoolsService, useValue: poolsService },
        {
          provide: CacheService,
          useValue: { get: jest.fn(), set: jest.fn() },
        },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PoolsController>(PoolsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('forwards the default query (inactive filtered) to the service', async () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };

    await controller.getPools({}, undefined, res as any);

    expect(poolsService.getPools).toHaveBeenCalledWith({});
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards includeInactive=true to the service', async () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };

    await controller.getPools(
      { includeInactive: true, page: 1, limit: 20 },
      undefined,
      res as any,
    );

    expect(poolsService.getPools).toHaveBeenCalledWith(
      expect.objectContaining({ includeInactive: true }),
    );
  });

  // ── #1206: raw query string → DTO → service, response shape unchanged ──────

  describe('includeInactive query parsing', () => {
    // Same options as the global pipe registered in app.setup.ts.
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const parse = (raw: Record<string, string>): Promise<GetPoolsQueryDto> =>
      pipe.transform(raw, { type: 'query', metatype: GetPoolsQueryDto });

    const makeRes = () => ({
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    });

    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])(
      'parses includeInactive=%s and forwards %s to the service',
      async (raw, expected) => {
        const res = makeRes();
        const query = await parse({ includeInactive: raw });

        await controller.getPools(query, undefined, res as any);

        expect(poolsService.getPools).toHaveBeenCalledWith(
          expect.objectContaining({ includeInactive: expected }),
        );
      },
    );

    it('leaves includeInactive undefined when the parameter is omitted', async () => {
      const res = makeRes();
      const query = await parse({});

      await controller.getPools(query, undefined, res as any);

      const forwarded = poolsService.getPools.mock.calls[0][0];
      expect(forwarded.includeInactive).toBeUndefined();
    });

    it('rejects a non-boolean includeInactive value', async () => {
      await expect(parse({ includeInactive: 'yes' })).rejects.toThrow();
    });

    it('returns the service payload unchanged, including each item active flag', async () => {
      const mixed = {
        ...emptyList,
        items: [
          { id: 'active-pool', active: true },
          { id: 'inactive-pool', active: false },
        ],
        total: 2,
        totalPages: 1,
      };
      poolsService.getPools.mockResolvedValueOnce(mixed);
      const res = makeRes();

      await controller.getPools(
        await parse({ includeInactive: 'true' }),
        undefined,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mixed);
    });
  });
});

// ── #1211: pool detail carries the cl-pool derivation marker ────────────────

describe('PoolsController - detail endpoint cl-pool view', () => {
  const poolId = 'cltest123456789012345678';
  let controller: PoolsController;
  let repo: { getPoolDetailById: jest.Mock; findClPoolView: jest.Mock };

  beforeEach(async () => {
    repo = {
      getPoolDetailById: jest.fn().mockResolvedValue(
        mockPoolDetailData({
          pool: {
            id: poolId,
            feeTier: 3000,
            currentSqrtPrice: '79228162514264337593543950336',
            currentTick: 0,
            liquidity: '1000000000000000000',
          },
          swaps: [mockSwap({ poolId })],
        }),
      ),
      findClPoolView: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PoolsController],
      providers: [
        // Real service: the cl-pool view must be derived from the pool record.
        PoolsService,
        { provide: PoolsRepository, useValue: repo },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            acquireSingleflightLock: jest.fn().mockResolvedValue(true),
            releaseSingleflightLock: jest.fn().mockResolvedValue(undefined),
            waitForSingleflightLock: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PoolsController>(PoolsController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('wraps the concentrated-liquidity fields in a ClPoolView with source "pool"', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_767_225_600_000);

    const detail = await controller.getPoolById(poolId);

    expect(detail.clPool).toEqual({
      source: 'pool',
      derived: true,
      poolId,
      derivedAt: 1_767_225_600_000,
      sqrtPriceX96: '79228162514264337593543950336',
      tick: 0,
      liquidity: '1000000000000000000',
      tickSpacing: 60,
    });
  });

  it('derives every cl-pool field from the pool record, not a parallel cl-pool read', async () => {
    const detail = await controller.getPoolById(poolId);

    expect(repo.getPoolDetailById).toHaveBeenCalledWith(poolId);
    expect(repo.findClPoolView).not.toHaveBeenCalled();
    expect(detail.clPool.poolId).toBe(detail.id);
    expect(detail.clPool.sqrtPriceX96).toBe(detail.currentSqrtPrice);
    expect(detail.clPool.tick).toBe(detail.currentTick);
    expect(detail.clPool.liquidity).toBe(detail.totalLiquidity);
    expect(typeof detail.clPool.derivedAt).toBe('number');
  });

  it.each([
    [500, 10],
    [3000, 60],
    [10_000, 200],
    [100, 60],
  ])('maps fee tier %d to tick spacing %d', async (feeTier, tickSpacing) => {
    repo.getPoolDetailById.mockResolvedValueOnce(
      mockPoolDetailData({ pool: { id: poolId, feeTier } }),
    );

    const detail = await controller.getPoolById(poolId);

    expect(detail.clPool.tickSpacing).toBe(tickSpacing);
  });
});
