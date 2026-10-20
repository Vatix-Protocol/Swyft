import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PoolsController } from './pools.controller';
import { PoolsService } from './pools.service';
import { CacheService } from '../cache/cache.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { GetPoolsQueryDto } from './dto/get-pools-query.dto';

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
