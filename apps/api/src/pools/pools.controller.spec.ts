import { Test, TestingModule } from '@nestjs/testing';
import { PoolsController } from './pools.controller';
import { PoolsService } from './pools.service';
import { CacheService } from '../cache/cache.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

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
});
