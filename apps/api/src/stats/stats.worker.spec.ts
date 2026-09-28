let mockProcessor: ((job: unknown) => Promise<void>) | undefined;
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);

jest.mock('bullmq', () => ({
  Worker: jest
    .fn()
    .mockImplementation((_name: string, processor: typeof mockProcessor) => {
      mockProcessor = processor;
      return {
        on: jest.fn(),
        close: mockWorkerClose,
      };
    }),
}));

import { Job } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { TvlAlertService } from './tvl-alert.service';
import { STATS_CACHE_KEY, StatsWorker } from './stats.worker';
import { TTL } from '../cache/cache.service';

describe('StatsWorker rolling volume metrics', () => {
  const now = Date.now();
  const mockPoolUpdate = jest.fn().mockResolvedValue(undefined);
  const mockSwapFindMany = jest.fn().mockResolvedValue([
    {
      amount0: '1000000',
      amount1: '0',
      feeAmount: '0',
      timestamp: new Date(now - 60 * 60 * 1000),
    },
    {
      amount0: '10000000',
      amount1: '0',
      feeAmount: '0',
      timestamp: new Date(now - 2 * 24 * 60 * 60 * 1000),
    },
    {
      amount0: '100000000',
      amount1: '0',
      feeAmount: '0',
      timestamp: new Date(now + 60 * 60 * 1000),
    },
  ]);
  const mockCache = {
    get: jest.fn().mockResolvedValue(2),
    set: jest.fn().mockResolvedValue(undefined),
  };

  let worker: StatsWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessor = undefined;
    const prisma = {
      pool: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pool-1',
            token0Address: 'TOKEN0',
            token1Address: 'TOKEN1',
            currentSqrtPrice: (1n << 96n).toString(),
          },
        ]),
        update: mockPoolUpdate,
      },
      swap: { findMany: mockSwapFindMany },
      token: {
        findUnique: jest.fn().mockResolvedValue({ decimals: 6 }),
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const alerts = {
      recordTvlSnapshot: jest.fn().mockResolvedValue(undefined),
      checkAndTriggerAlerts: jest.fn().mockResolvedValue(undefined),
    };
    worker = new StatsWorker(
      prisma as unknown as PrismaService,
      mockCache as unknown as CacheService,
      alerts as unknown as TvlAlertService,
    );
    worker.onModuleInit();
  });

  it('bounds the source query and independently excludes out-of-window rows', async () => {
    expect(mockProcessor).toBeDefined();
    await mockProcessor!({} as Job);

    const query = mockSwapFindMany.mock.calls[0][0];
    expect(query.where.timestamp.gte).toBeInstanceOf(Date);
    expect(query.where.timestamp.lt).toBeInstanceOf(Date);
    expect(query.orderBy).toEqual({ timestamp: 'asc' });

    expect(mockPoolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ volume24h: '2' }),
      }),
    );
    expect(mockCache.set).toHaveBeenCalledWith(
      STATS_CACHE_KEY('pool-1'),
      expect.objectContaining({ volume24h: 2, volume7d: 22 }),
      TTL.STATS,
    );
  });

  afterEach(async () => {
    await worker.onModuleDestroy();
  });
});
