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

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockPools = [
  { id: 'pool-1', token0Address: 'TOKENA', token1Address: 'TOKENB', feeTier: 3000 },
];

const mockSwaps24h = [
  { amount0: '1000000', amount1: '-500000' },
  { amount0: '2000000', amount1: '-1000000' },
];

const mockSwaps7d = [
  ...mockSwaps24h,
  { amount0: '500000', amount1: '-250000' },
];

const mockPositions = [{ liquidity: '1000000000' }];

const mockPoolUpdate = jest.fn().mockResolvedValue({});
const mockFindManyPools = jest.fn().mockResolvedValue(mockPools);
const mockFindManySwaps = jest.fn();
const mockFindManyPositions = jest.fn().mockResolvedValue(mockPositions);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    pool: { findMany: mockFindManyPools, update: mockPoolUpdate },
    swap: { findMany: mockFindManySwaps },
    position: { findMany: mockFindManyPositions },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsScheduler, STATS_QUEUE } from './stats.scheduler';
import { StatsWorker } from './stats.worker';
import { StatsModule } from './stats.module';
import { CacheService } from '../cache/cache.service';
import { STATS_JOB_NAME } from './stats.queue';
import { defaultJobOptions } from '../indexer/queues';
import { Job } from 'bullmq';

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
  const mockCacheService = { get: jest.fn().mockResolvedValue(null) };

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({ imports: [StatsModule] })
      .overrideProvider(CacheService)
      .useValue(mockCacheService)
      .compile();
  });

  afterEach(async () => {
    await module.close();
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

// ─── StatsWorker — volume24h from Swap timestamps (#356) ─────────────────────

describe('StatsWorker — volume24h from swap timestamps', () => {
  let worker: StatsWorker;
  let module: TestingModule;
  let processJob: (job: Job) => Promise<void>;
  const mockCacheService = { get: jest.fn().mockResolvedValue(null) };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindManySwaps.mockImplementation(
      ({ where }: { where: { timestamp: { gte: Date } } }) => {
        const cutoff = where.timestamp.gte.getTime();
        const now = Date.now();
        const ms24h = 24 * 60 * 60 * 1000;
        const ms7d = 7 * ms24h;
        if (Math.abs(cutoff - (now - ms24h)) < 60_000) return Promise.resolve(mockSwaps24h);
        if (Math.abs(cutoff - (now - ms7d)) < 60_000) return Promise.resolve(mockSwaps7d);
        return Promise.resolve([]);
      },
    );

    module = await Test.createTestingModule({
      providers: [
        StatsWorker,
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    worker = module.get<StatsWorker>(StatsWorker);
    worker.onModuleInit();

    // Extract the process callback registered with the BullMQ Worker constructor
    const workerCall = MockWorker.mock.calls.find((c) => c[0] === 'stats.aggregate');
    processJob = workerCall![1] as (job: Job) => Promise<void>;
    await processJob({} as Job);
  });

  afterEach(async () => {
    await module.close();
  });

  it('queries swaps using a Date-based timestamp filter', () => {
    const swapCalls = mockFindManySwaps.mock.calls.filter(
      (c: [{ where?: { timestamp?: unknown } }]) => c[0]?.where?.timestamp,
    );
    expect(swapCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of swapCalls) {
      expect(call[0].where.timestamp.gte).toBeInstanceOf(Date);
    }
  });

  it('uses Swap.timestamp (not job-enqueue time) as both the 24h and 7d window cutoffs', () => {
    const now = Date.now();
    const cutoffs = mockFindManySwaps.mock.calls
      .filter((c: [{ where?: { timestamp?: { gte?: Date } } }]) => c[0]?.where?.timestamp?.gte)
      .map((c: [{ where: { timestamp: { gte: Date } } }]) => c[0].where.timestamp.gte.getTime());

    const ago24h = now - 24 * 60 * 60 * 1000;
    const ago7d = now - 7 * 24 * 60 * 60 * 1000;

    expect(cutoffs.some((t: number) => Math.abs(t - ago24h) < 60_000)).toBe(true);
    expect(cutoffs.some((t: number) => Math.abs(t - ago7d) < 60_000)).toBe(true);
  });

  it('computes volume24h as sum of |amount0| + |amount1| across 24h swaps (price=1)', () => {
    // swap1: |1000000| + |500000| = 1500000
    // swap2: |2000000| + |1000000| = 3000000 → total 4500000
    expect(mockPoolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ volume24h: '4500000' }),
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
});
