// ─── BullMQ mock ─────────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'stats-job-1' });
const MockQueue = jest.fn().mockImplementation((name: string) => ({
  name,
  add: mockQueueAdd,
  close: jest.fn().mockResolvedValue(undefined),
}));

const mockWorkerOn = jest.fn();
const MockWorker = jest.fn().mockImplementation((_name: string) => ({
  name: _name,
  on: mockWorkerOn,
  close: jest.fn().mockResolvedValue(undefined),
  client: Promise.resolve({ llen: jest.fn().mockResolvedValue(0) }),
}));

jest.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  Job: jest.fn(),
}));

const mockPools = [
  {
    id: 'pool-1',
    token0Address: 'TOKENA',
    token1Address: 'TOKENB',
    feeTier: 3000,
    liquidity: '1000000000',
    currentSqrtPrice: '79228162514264337593543950336', // price = 1
  },
];

const mockSwaps24h = [
  {
    amount0: '1000000',
    amount1: '-500000',
    feeAmount: '3000',
    timestamp: new Date(Date.now() - 60 * 60 * 1000),
  },
  {
    amount0: '2000000',
    amount1: '-1000000',
    feeAmount: '6000',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
];

const mockSwaps7d = [
  ...mockSwaps24h,
  {
    amount0: '500000',
    amount1: '-250000',
    feeAmount: '1500',
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
];

const mockPositions = [
  {
    lowerTick: -200,
    upperTick: 200,
    liquidity: '1000000000',
  },
];

const mockPoolUpdate = jest.fn().mockResolvedValue({});
const mockFindManyPools = jest.fn().mockResolvedValue(mockPools);
const mockFindManySwaps = jest.fn();
const mockFindManyPositions = jest.fn().mockResolvedValue(mockPositions);

const mockFindUniqueToken = jest.fn().mockResolvedValue({ decimals: 6 });

const mockPrismaService = {
  pool: { findMany: mockFindManyPools, update: mockPoolUpdate },
  swap: { findMany: mockFindManySwaps },
  position: { findMany: mockFindManyPositions },
  token: { findUnique: mockFindUniqueToken },
};

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { StatsWorker } from './stats.worker';
import { StatsModule } from './stats.module';
import { CacheService } from '../cache/cache.service';
import { IndexerMonitorService } from '../metrics/indexer-monitor.service';
import { DbMetricsService } from '../metrics/db-metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TvlAlertService } from './tvl-alert.service';
import { STATS_JOB_NAME } from './stats.queue';
import { defaultJobOptions } from '../indexer/queues';
import { Job } from 'bullmq';
import { STATS_CACHE_KEY } from './stats.worker';
import { STELLAR_CONFIG_KEY } from '../config/stellar.config';

// ─── StatsScheduler (#354) ────────────────────────────────────────────────────

describe('StatsScheduler', () => {
  let scheduler: StatsScheduler;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        StatsScheduler,
        { provide: STATS_QUEUE, useValue: { add: mockQueueAdd } },
      ],
    }).compile();

    scheduler = module.get<StatsScheduler>(StatsScheduler);
  });

  afterEach(async () => {
    await module.close();
  });

  it('is defined after AppModule wires StatsModule', () => {
    expect(scheduler).toBeDefined();
  });

  it('enqueues a pool-stats job when scheduleAggregation is called', async () => {
    await scheduler.scheduleAggregation();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      STATS_JOB_NAME,
      {},
      expect.objectContaining({
        jobId: expect.stringMatching(/^pool-stats-\d+$/),
      }),
    );
  });

  it('deduplicates within the same 5-minute window via stable jobId', async () => {
    await scheduler.scheduleAggregation();
    await scheduler.scheduleAggregation();

    const [first, second] = mockQueueAdd.mock.calls;
    expect(first[2].jobId).toBe(second[2].jobId);
  });

  it('includes defaultJobOptions in the enqueue call', async () => {
    await scheduler.scheduleAggregation();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      expect.any(String),
      {},
      expect.objectContaining({ attempts: defaultJobOptions.attempts }),
    );
  });
});

// ─── StatsModule compiles with ScheduleModule (#354) ─────────────────────────

describe('StatsModule', () => {
  let module: TestingModule;
  const mockCacheService = {
    get: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              [STELLAR_CONFIG_KEY]: {
                rpcUrl: 'https://soroban-testnet.stellar.org',
                horizonUrl: 'https://horizon-testnet.stellar.org',
                network: 'testnet',
                poolContractId: '',
              },
            }),
          ],
        }),
        StatsModule,
      ],
    })
      .overrideProvider(CacheService)
      .useValue(mockCacheService)
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(IndexerMonitorService)
      .useValue({ onModuleInit: () => {}, onModuleDestroy: () => {} })
      .overrideProvider(DbMetricsService)
      .useValue({})
      .compile();
    await module.init();
  });

  afterEach(async () => {
    await module?.close();
  });

  it('compiles without errors', () => {
    expect(module).toBeDefined();
  });

  it('provides StatsScheduler', () => {
    expect(module.get(StatsScheduler)).toBeDefined();
  });

  it('provides StatsWorker', () => {
    expect(module.get(StatsWorker)).toBeDefined();
  });
});

// ─── StatsWorker — exact rolling volume windows (#1053) ────────────────────────

describe('StatsWorker — volume24h from swap timestamps', () => {
  let worker: StatsWorker;
  let module: TestingModule;
  let processJob: (job: Job) => Promise<void>;
  const mockCacheService = {
    get: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindManySwaps.mockImplementation(
      ({ where }: { where: { timestamp: { gte: Date } } }) => {
        const cutoff = where.timestamp.gte.getTime();
        const now = Date.now();
        const ms24h = 24 * 60 * 60 * 1000;
        const ms7d = 7 * ms24h;
        if (Math.abs(cutoff - (now - ms24h)) < 60_000)
          return Promise.resolve(mockSwaps24h);
        if (Math.abs(cutoff - (now - ms7d)) < 60_000)
          return Promise.resolve(mockSwaps7d);
        return Promise.resolve([]);
      },
    );

    module = await Test.createTestingModule({
      providers: [
        StatsWorker,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: TvlAlertService,
          useValue: {
            recordTvlSnapshot: jest.fn().mockResolvedValue(undefined),
            checkAndTriggerAlerts: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    worker = module.get<StatsWorker>(StatsWorker);
    worker.onModuleInit();

    // Extract the process callback registered with the BullMQ Worker constructor
    const workerCall = MockWorker.mock.calls.find(
      (c) => c[0] === 'stats.aggregate',
    );
    processJob = workerCall![1] as (job: Job) => Promise<void>;
    await processJob({} as Job);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('queries one bounded seven-day swap window using Date filters', () => {
    const swapCalls = mockFindManySwaps.mock.calls.filter(
      (c: [{ where?: { timestamp?: unknown } }]) => c[0]?.where?.timestamp,
    );
    expect(swapCalls).toHaveLength(1);
    expect(swapCalls[0][0].where.timestamp.gte).toBeInstanceOf(Date);
    expect(swapCalls[0][0].where.timestamp.lt).toBeInstanceOf(Date);
  });

  it('bounds the query to the rolling seven-day window ending at the aggregation time', () => {
    const now = Date.now();
    const query = mockFindManySwaps.mock.calls
      .filter(
        (c: [{ where?: { timestamp?: { gte?: Date; lt?: Date } } }]) =>
          c[0]?.where?.timestamp?.gte,
      )
      .map(
        (c: [{ where: { timestamp: { gte: Date; lt: Date } } }]) =>
          c[0].where.timestamp,
      )[0];
    const ago7d = now - 7 * 24 * 60 * 60 * 1000;

    expect(query.gte.getTime()).toBeGreaterThanOrEqual(ago7d - 60_000);
    expect(query.gte.getTime()).toBeLessThanOrEqual(ago7d + 60_000);
    expect(query.lt.getTime()).toBeGreaterThanOrEqual(now - 1000);
    expect(query.lt.getTime()).toBeLessThanOrEqual(now + 1000);
  });

  it('computes volume24h in USD from base-unit amounts in the half-open 24-hour window', () => {
    // (1.0 + 0.5) + (2.0 + 1.0) = $4.50 at a $1 token price.
    expect(mockPoolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ volume24h: '4.5' }),
      }),
    );
  });

  it('persists volume24h, tvl, and feeApr in one pool update', () => {
    expect(mockPoolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pool-1' },
        data: expect.objectContaining({
          volume24h: expect.any(String),
          tvl: expect.any(String),
          feeApr: expect.any(String),
        }),
      }),
    );
  });

  it('computes feeApr from actual swap feeAmount fields (not feeTier * volume)', () => {
    // fees24h = (3000 + 6000) base units / 10^6 * priceA(1) = $0.009
    const updateCall = mockPoolUpdate.mock.calls[0][0];
    const tvl = Number(updateCall.data.tvl);
    const feeApr = Number(updateCall.data.feeApr);
    expect(feeApr).toBeGreaterThan(0);
    // The fee amount is converted from token0 base units using its indexed decimals.
    // Verify the actual value matches fees24h / tvl * 365 * 100
    const expectedFeeApr = (0.009 / tvl) * 365 * 100;
    expect(feeApr).toBeCloseTo(expectedFeeApr, 5);
  });

  it('computes TVL from the exact open position ranges instead of aggregate liquidity', () => {
    const updateCall = mockPoolUpdate.mock.calls[0][0];
    const tvl = Number(updateCall.data.tvl);
    expect(mockFindManyPositions).toHaveBeenCalledWith({
      where: { poolId: 'pool-1', closedAt: null },
      select: { lowerTick: true, upperTick: true, liquidity: true },
    });
    expect(Number.isFinite(tvl)).toBe(true);
    expect(tvl).toBeGreaterThan(0);
    expect(tvl).toBeLessThan(2_000_000_000);
  });
});
