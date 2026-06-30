import { Job, Queue, Worker, QueueEvents } from 'bullmq';

// ─── BullMQ mocks ─────────────────────────────────────────────────────────────
// We mock the entire bullmq module so no Redis connection is needed in unit tests.

const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerClient = Promise.resolve({
  llen: jest.fn().mockResolvedValue(0),
});

const MockWorker = jest
  .fn()
  .mockImplementation((_name: string, _handler: unknown) => ({
    name: _name,
    on: mockWorkerOn,
    close: mockWorkerClose,
    client: mockWorkerClient,
  }));

const mockQueueEventsOn = jest.fn();
const mockQueueEventsClose = jest.fn().mockResolvedValue(undefined);

const MockQueueEvents = jest.fn().mockImplementation(() => ({
  on: mockQueueEventsOn,
  close: mockQueueEventsClose,
}));

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueClose = jest.fn().mockResolvedValue(undefined);

const MockQueue = jest.fn().mockImplementation((name: string) => ({
  name,
  add: mockQueueAdd,
  close: mockQueueClose,
}));

jest.mock('bullmq', () => ({
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
  Queue: MockQueue,
  Job: jest.fn(),
}));

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockUpsert = () => jest.fn().mockResolvedValue({});

const mockPrismaClient = {
  token: { upsert: mockUpsert() },
  pool: { upsert: mockUpsert(), update: mockUpsert() },
  swap: { upsert: mockUpsert() },
  position: { upsert: mockUpsert() },
  poolCreated: { upsert: mockUpsert() },
  swapProcessed: { upsert: mockUpsert() },
  positionMinted: { upsert: mockUpsert() },
  positionBurned: { upsert: mockUpsert() },
  feesCollected: { upsert: mockUpsert() },
  indexerDeadLetter: {
    upsert: mockUpsert(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(0),
  },
  $transaction: jest.fn((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  ),
  $disconnect: jest.fn().mockResolvedValue(undefined),
};

const mockSetMaxNumber = jest.fn().mockResolvedValue(true);
const mockCacheService = { setMaxNumber: mockSetMaxNumber };
const mockAdvanceLedger = jest.fn((ledger: number) =>
  mockSetMaxNumber('indexer:last_ledger', ledger),
);
const mockCursorService = { advanceLedger: mockAdvanceLedger };
const mockDeadLetterService = {
  recordDeadLetter: jest.fn().mockResolvedValue(undefined),
};

const mockWebhooksService = {
  dispatch: jest.fn().mockResolvedValue(undefined),
};

const mockTokenEnrichmentService = {
  enrichToken: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrismaClient),
}));

// ─── Imports (after mocks are set up) ────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { IndexerWorker } from './indexer.worker';
import { CacheService } from '../cache/cache.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TokenEnrichmentService } from '../tokens/token-enrichment.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';
import { IndexerCursorService } from './indexer-cursor.service';
import { IndexerDeadLetterService } from './indexer-dead-letter.service';
import {
  IndexerModule,
  QUEUE_POOL_CREATED,
  QUEUE_SWAP_PROCESSED,
  QUEUE_POSITION_MINTED,
  QUEUE_POSITION_BURNED,
  QUEUE_FEES_COLLECTED,
} from './indexer.module';
import {
  createQueue,
  makeQueueOptions,
  QUEUE_NAMES,
  defaultJobOptions,
} from './queues';
import type {
  PoolCreatedJobData,
  SwapProcessedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
  FeesCollectedJobData,
} from './queues';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob<T>(data: T): Job<T> {
  return { data, id: 'test-job-id', attemptsMade: 1 } as unknown as Job<T>;
}

// ─── queues.ts ────────────────────────────────────────────────────────────────

describe('queues', () => {
  describe('QUEUE_NAMES', () => {
    it('defines all five queue names', () => {
      expect(Object.keys(QUEUE_NAMES)).toHaveLength(5);
    });

    it('has the expected queue name values', () => {
      expect(QUEUE_NAMES.POOL_CREATED).toBe('pool.created');
      expect(QUEUE_NAMES.SWAP_PROCESSED).toBe('swap.processed');
      expect(QUEUE_NAMES.POSITION_MINTED).toBe('position.minted');
      expect(QUEUE_NAMES.POSITION_BURNED).toBe('position.burned');
      expect(QUEUE_NAMES.FEES_COLLECTED).toBe('fees.collected');
    });
  });

  describe('makeQueueOptions()', () => {
    it('returns a connection object', () => {
      const opts = makeQueueOptions();
      expect(opts.connection).toBeDefined();
    });

    it('falls back to localhost Redis when REDIS_URL is not set', () => {
      const original = process.env.REDIS_URL;
      delete process.env.REDIS_URL;

      const opts = makeQueueOptions();
      expect((opts.connection as { url: string }).url).toBe(
        'redis://localhost:6379',
      );

      process.env.REDIS_URL = original;
    });

    it('uses REDIS_URL env var when set', () => {
      const original = process.env.REDIS_URL;
      process.env.REDIS_URL = 'redis://custom-host:1234';

      const opts = makeQueueOptions();
      expect((opts.connection as { url: string }).url).toBe(
        'redis://custom-host:1234',
      );

      process.env.REDIS_URL = original;
    });

    it('includes defaultJobOptions', () => {
      const opts = makeQueueOptions();
      expect(opts.defaultJobOptions).toEqual(defaultJobOptions);
    });
  });

  describe('defaultJobOptions', () => {
    it('retries 3 times', () => {
      expect(defaultJobOptions.attempts).toBe(3);
    });

    it('uses exponential backoff', () => {
      expect(defaultJobOptions.backoff.type).toBe('exponential');
    });

    it('keeps last 100 completed jobs', () => {
      expect(defaultJobOptions.removeOnComplete).toEqual({ count: 100 });
    });

    it('does not remove failed jobs', () => {
      expect(defaultJobOptions.removeOnFail).toBe(false);
    });
  });

  describe('createQueue()', () => {
    it('creates a Queue with the given name', () => {
      createQueue(QUEUE_NAMES.POOL_CREATED);
      expect(MockQueue).toHaveBeenCalledWith(
        QUEUE_NAMES.POOL_CREATED,
        expect.objectContaining({ connection: expect.anything() }),
      );
    });

    it('creates a Queue with the correct options', () => {
      createQueue(QUEUE_NAMES.SWAP_PROCESSED);
      expect(MockQueue).toHaveBeenCalledWith(
        QUEUE_NAMES.SWAP_PROCESSED,
        expect.objectContaining({ defaultJobOptions }),
      );
    });
  });
});

// ─── IndexerModule ────────────────────────────────────────────────────────────

describe('IndexerModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [IndexerModule],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('compiles without errors', () => {
    expect(module).toBeDefined();
  });

  it('provides QUEUE_POOL_CREATED token', () => {
    const queue = module.get(QUEUE_POOL_CREATED);
    expect(queue).toBeDefined();
  });

  it('provides QUEUE_SWAP_PROCESSED token', () => {
    const queue = module.get(QUEUE_SWAP_PROCESSED);
    expect(queue).toBeDefined();
  });

  it('provides QUEUE_POSITION_MINTED token', () => {
    const queue = module.get(QUEUE_POSITION_MINTED);
    expect(queue).toBeDefined();
  });

  it('provides QUEUE_POSITION_BURNED token', () => {
    const queue = module.get(QUEUE_POSITION_BURNED);
    expect(queue).toBeDefined();
  });

  it('provides QUEUE_FEES_COLLECTED token', () => {
    const queue = module.get(QUEUE_FEES_COLLECTED);
    expect(queue).toBeDefined();
  });

  it('exports all five queue tokens', () => {
    // All five tokens are accessible from outside the module
    const tokens = [
      QUEUE_POOL_CREATED,
      QUEUE_SWAP_PROCESSED,
      QUEUE_POSITION_MINTED,
      QUEUE_POSITION_BURNED,
      QUEUE_FEES_COLLECTED,
    ];
    for (const token of tokens) {
      expect(module.get(token)).toBeDefined();
    }
  });
});

// ─── IndexerWorker ────────────────────────────────────────────────────────────

describe('IndexerWorker', () => {
  let worker: IndexerWorker;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        IndexerWorker,
        { provide: CacheService, useValue: mockCacheService },
        { provide: WebhooksService, useValue: mockWebhooksService },
        {
          provide: TokenEnrichmentService,
          useValue: mockTokenEnrichmentService,
        },
        { provide: IndexerCursorService, useValue: mockCursorService },
        { provide: IndexerDeadLetterService, useValue: mockDeadLetterService },
      ],
    }).compile();

    worker = module.get<IndexerWorker>(IndexerWorker);
  });

  afterEach(async () => {
    await module.close();
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('creates one Worker per queue name', () => {
      worker.onModuleInit();
      expect(MockWorker).toHaveBeenCalledTimes(Object.keys(QUEUE_NAMES).length);
    });

    it('creates workers for all five queue names', () => {
      worker.onModuleInit();
      const calledNames = MockWorker.mock.calls.map((c) => c[0] as string);
      expect(calledNames).toEqual(
        expect.arrayContaining(Object.values(QUEUE_NAMES)),
      );
    });

    it('creates one QueueEvents listener per queue name', () => {
      worker.onModuleInit();
      expect(MockQueueEvents).toHaveBeenCalledTimes(
        Object.keys(QUEUE_NAMES).length,
      );
    });

    it('registers a "failed" event listener on each QueueEvents instance', () => {
      worker.onModuleInit();
      const failedCalls = mockQueueEventsOn.mock.calls.filter(
        (c) => c[0] === 'failed',
      );
      expect(failedCalls).toHaveLength(Object.keys(QUEUE_NAMES).length);
    });

    it('registers "completed" and "failed" event listeners on each Worker', () => {
      worker.onModuleInit();
      const completedCalls = mockWorkerOn.mock.calls.filter(
        (c) => c[0] === 'completed',
      );
      const failedCalls = mockWorkerOn.mock.calls.filter(
        (c) => c[0] === 'failed',
      );
      expect(completedCalls).toHaveLength(Object.keys(QUEUE_NAMES).length);
      expect(failedCalls).toHaveLength(Object.keys(QUEUE_NAMES).length);
    });

    it('records poison events in the dead letter queue after retries are exhausted', async () => {
      worker.onModuleInit();
      const failed = mockWorkerOn.mock.calls.find(
        (c) => c[0] === 'failed',
      )?.[1] as
        | ((job: Job<PoolCreatedJobData>, err: Error) => void)
        | undefined;

      failed?.(
        makeJob({
          eventId: 'evt-poison',
          poolId: 'pool',
        } as PoolCreatedJobData) as Job<PoolCreatedJobData>,
        new Error('poison event'),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockDeadLetterService.recordDeadLetter).not.toHaveBeenCalled();

      failed?.(
        {
          ...makeJob({
            eventId: 'evt-poison',
            poolId: 'pool',
          } as PoolCreatedJobData),
          attemptsMade: 3,
        },
        new Error('poison event'),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockDeadLetterService.recordDeadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          queueName: QUEUE_NAMES.POOL_CREATED,
          eventId: 'evt-poison',
          error: 'poison event',
          attemptsMade: 3,
        }),
      );
    });

    it('configures stalled-job recovery for a worker crash mid-batch', () => {
      worker.onModuleInit();

      expect(MockWorker).toHaveBeenCalledWith(
        QUEUE_NAMES.POOL_CREATED,
        expect.any(Function),
        expect.objectContaining({
          lockDuration: 60_000,
          stalledInterval: 30_000,
          maxStalledCount: 2,
        }),
      );
    });

    it('has a loading state property on the worker', async () => {
      expect(worker.isLoading).toBe(false);
      await worker.onModuleInit();
      expect(worker.isLoading).toBe(false);
    });
  });

  describe('onModuleDestroy()', () => {
    it('closes all workers and queue events', async () => {
      worker.onModuleInit();
      await worker.onModuleDestroy();

      expect(mockWorkerClose).toHaveBeenCalledTimes(
        Object.keys(QUEUE_NAMES).length,
      );
      expect(mockQueueEventsClose).toHaveBeenCalledTimes(
        Object.keys(QUEUE_NAMES).length,
      );
    });

    it('disconnects Prisma on shutdown', async () => {
      worker.onModuleInit();
      await worker.onModuleDestroy();

      expect(mockPrismaClient.$disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Job handlers (via Worker constructor callback) ────────────────────────
  // We extract the handler passed to the Worker constructor and invoke it directly.

  function getHandlerForQueue(
    queueName: string,
  ): (job: Job<unknown>) => Promise<void> {
    worker.onModuleInit();
    const call = MockWorker.mock.calls.find((c) => c[0] === queueName);
    if (!call) throw new Error(`No worker registered for queue: ${queueName}`);
    return call[1] as (job: Job<unknown>) => Promise<void>;
  }

  describe('handlePoolCreated()', () => {
    const data: PoolCreatedJobData = {
      eventId: 'evt-pool-1',
      poolId: 'pool-abc',
      tokenA: 'XLM',
      tokenB: 'USDC',
      fee: '30',
      sqrtPriceX96: '79228162514264337593543950336',
    };

    it('upserts a PoolCreated record in Prisma', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));

      expect(mockPrismaClient.poolCreated.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: data.eventId },
          create: expect.objectContaining({
            eventId: data.eventId,
            poolId: data.poolId,
          }),
        }),
      );
    });

    it('uses an empty update object (idempotent upsert)', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));

      expect(mockPrismaClient.poolCreated.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });

    it('projects the event into Pool and Token tables', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));

      expect(mockPrismaClient.token.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { address: data.tokenA } }),
      );
      expect(mockPrismaClient.token.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { address: data.tokenB } }),
      );
      expect(mockPrismaClient.pool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: data.poolId },
          create: expect.objectContaining({
            currentSqrtPrice: data.sqrtPriceX96,
          }),
        }),
      );
    });

    it('backfills token/fee fields on conflict, correcting a placeholder pool created by an earlier swap', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));

      expect(mockPrismaClient.pool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: data.poolId },
          update: expect.objectContaining({
            token0Address: data.tokenA,
            token1Address: data.tokenB,
            feeTier: parseInt(data.fee, 10),
            currentSqrtPrice: data.sqrtPriceX96,
          }),
        }),
      );
    });

    it('is idempotent — calling twice does not throw', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));
      await handler(makeJob(data));

      expect(mockPrismaClient.poolCreated.upsert).toHaveBeenCalledTimes(2);
    });

    it('advances the Redis ledger checkpoint after a successful write', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob({ ...data, ledger: 12345 }));

      expect(mockSetMaxNumber).toHaveBeenCalledWith(
        LAST_INDEXED_LEDGER_KEY,
        12345,
      );
      expect(mockAdvanceLedger).toHaveBeenCalledWith(12345);
    });

    it('dispatches a pool.created webhook after successful write', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));

      // Wait for any async promises
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWebhooksService.dispatch).toHaveBeenCalledWith(
        'pool.created',
        expect.objectContaining({
          poolId: data.poolId,
          tokenA: data.tokenA,
          tokenB: data.tokenB,
          eventId: data.eventId,
        }),
      );
    });

    it('continues processing even when webhook dispatch fails', async () => {
      mockWebhooksService.dispatch.mockRejectedValueOnce(
        new Error('Webhook delivery failed'),
      );

      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await expect(handler(makeJob(data))).resolves.not.toThrow();

      expect(mockPrismaClient.poolCreated.upsert).toHaveBeenCalled();
    });

    it('calls enrichToken for both pool tokens after pool is persisted', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(data));

      expect(mockTokenEnrichmentService.enrichToken).toHaveBeenCalledWith(data.tokenA);
      expect(mockTokenEnrichmentService.enrichToken).toHaveBeenCalledWith(data.tokenB);
    });
  });

  describe('handleSwapProcessed()', () => {
    const data: SwapProcessedJobData = {
      eventId: 'evt-swap-1',
      poolId: 'pool-abc',
      sender: '0xSender',
      recipient: '0xRecipient',
      amount0: '1000000',
      amount1: '-500000',
      sqrtPriceX96: '79228162514264337593543950336',
      liquidity: '1000000000000000000',
      tick: 42,
    };

    it('upserts a SwapProcessed record in Prisma', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(data));

      expect(mockPrismaClient.swapProcessed.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: data.eventId },
          create: expect.objectContaining({
            eventId: data.eventId,
            sender: data.sender,
            recipient: data.recipient,
            tick: data.tick,
          }),
        }),
      );
    });

    it('stores the tick value correctly', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(data));

      const call = mockPrismaClient.swapProcessed.upsert.mock.calls[0][0];
      expect(call.create.tick).toBe(42);
    });

    it('projects a swap into the canonical Swap and Pool tables', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(data));

      expect(mockPrismaClient.swap.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: data.eventId },
          create: expect.objectContaining({
            poolId: data.poolId,
            tickAfter: data.tick,
          }),
        }),
      );
      expect(mockPrismaClient.pool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: data.poolId },
          update: expect.objectContaining({
            currentSqrtPrice: data.sqrtPriceX96,
            currentTick: data.tick,
            liquidity: data.liquidity,
          }),
        }),
      );
    });

    it('creates the pool when a swap arrives before its pool.created event', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(data));

      expect(mockPrismaClient.pool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: data.poolId },
          create: expect.objectContaining({
            id: data.poolId,
            currentSqrtPrice: data.sqrtPriceX96,
            currentTick: data.tick,
            liquidity: data.liquidity,
          }),
        }),
      );
    });

    it('does not throw when the pool does not exist yet (first state update)', async () => {
      // Simulate Prisma's real behavior for `update` on a missing row, to
      // document why `upsert` (not `update`) is required here.
      mockPrismaClient.pool.upsert.mockResolvedValueOnce({});

      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await expect(handler(makeJob(data))).resolves.not.toThrow();
    });

    it('dispatches a swap.large webhook after successful write', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(data));

      // Wait for any async promises
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockWebhooksService.dispatch).toHaveBeenCalledWith(
        'swap.large',
        expect.objectContaining({
          poolId: data.poolId,
          sender: data.sender,
          recipient: data.recipient,
          eventId: data.eventId,
        }),
      );
    });

    it('continues processing even when webhook dispatch fails for swap', async () => {
      mockWebhooksService.dispatch.mockRejectedValueOnce(
        new Error('Webhook delivery failed'),
      );

      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await expect(handler(makeJob(data))).resolves.not.toThrow();

      expect(mockPrismaClient.swapProcessed.upsert).toHaveBeenCalled();
    });
  });

  describe('handlePositionMinted()', () => {
    const data: PositionMintedJobData = {
      eventId: 'evt-mint-1',
      poolId: 'pool-abc',
      tokenId: '1',
      owner: '0xOwner',
      tickLower: -887272,
      tickUpper: 887272,
      liquidity: '500000000000000000',
      amount0: '1000000',
      amount1: '500000',
    };

    it('upserts a PositionMinted record in Prisma', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POSITION_MINTED);
      await handler(makeJob(data));

      expect(mockPrismaClient.positionMinted.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: data.eventId },
          create: expect.objectContaining({
            owner: data.owner,
            tickLower: data.tickLower,
            tickUpper: data.tickUpper,
          }),
        }),
      );
    });

    it('upserts the current Position by pool and token ID', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POSITION_MINTED);
      await handler(makeJob(data));

      expect(mockPrismaClient.position.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            poolId_tokenId: { poolId: data.poolId, tokenId: data.tokenId },
          },
        }),
      );
    });
  });

  describe('handlePositionBurned()', () => {
    const data: PositionBurnedJobData = {
      eventId: 'evt-burn-1',
      poolId: 'pool-abc',
      tokenId: '1',
      owner: '0xOwner',
      tickLower: -887272,
      tickUpper: 887272,
      liquidity: '500000000000000000',
      amount0: '1000000',
      amount1: '500000',
    };

    it('upserts a PositionBurned record in Prisma', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POSITION_BURNED);
      await handler(makeJob(data));

      expect(mockPrismaClient.positionBurned.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: data.eventId },
          create: expect.objectContaining({
            owner: data.owner,
            liquidity: data.liquidity,
          }),
        }),
      );
    });

    it('marks a zero-liquidity position as closed', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.POSITION_BURNED);
      await handler(makeJob({ ...data, liquidity: '0' }));

      expect(mockPrismaClient.position.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ closedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('handleFeesCollected()', () => {
    const data: FeesCollectedJobData = {
      eventId: 'evt-fees-1',
      poolId: 'pool-abc',
      recipient: '0xRecipient',
      amount0: '5000',
      amount1: '2500',
    };

    it('upserts a FeesCollected record in Prisma', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.FEES_COLLECTED);
      await handler(makeJob(data));

      expect(mockPrismaClient.feesCollected.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: data.eventId },
          create: expect.objectContaining({
            recipient: data.recipient,
            amount0: data.amount0,
            amount1: data.amount1,
          }),
        }),
      );
    });

    it('is idempotent — duplicate events do not throw', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.FEES_COLLECTED);
      await handler(makeJob(data));
      await handler(makeJob(data));

      expect(mockPrismaClient.feesCollected.upsert).toHaveBeenCalledTimes(2);
    });

    it('uses the event id as the unique upsert key for every event type', async () => {
      await getHandlerForQueue(QUEUE_NAMES.POOL_CREATED)(
        makeJob({
          eventId: 'evt-pool-idempotent',
          poolId: 'pool',
          tokenA: 'A',
          tokenB: 'B',
          fee: '1',
          sqrtPriceX96: '1',
        }),
      );
      await getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED)(
        makeJob({
          eventId: 'evt-swap-idempotent',
          poolId: 'pool',
          sender: 'sender',
          recipient: 'recipient',
          amount0: '1',
          amount1: '1',
          sqrtPriceX96: '1',
          liquidity: '1',
          tick: 0,
        }),
      );
      await getHandlerForQueue(QUEUE_NAMES.POSITION_MINTED)(
        makeJob({
          eventId: 'evt-mint-idempotent',
          poolId: 'pool',
          owner: 'owner',
          tickLower: 0,
          tickUpper: 1,
          liquidity: '1',
          amount0: '1',
          amount1: '1',
        }),
      );
      await getHandlerForQueue(QUEUE_NAMES.POSITION_BURNED)(
        makeJob({
          eventId: 'evt-burn-idempotent',
          poolId: 'pool',
          owner: 'owner',
          tickLower: 0,
          tickUpper: 1,
          liquidity: '1',
          amount0: '1',
          amount1: '1',
        }),
      );
      await getHandlerForQueue(QUEUE_NAMES.FEES_COLLECTED)(
        makeJob({
          eventId: 'evt-fees-idempotent',
          poolId: 'pool',
          recipient: 'recipient',
          amount0: '1',
          amount1: '1',
        }),
      );

      for (const model of [
        mockPrismaClient.poolCreated,
        mockPrismaClient.swapProcessed,
        mockPrismaClient.positionMinted,
        mockPrismaClient.positionBurned,
        mockPrismaClient.feesCollected,
      ]) {
        expect(model.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { eventId: expect.any(String) },
            update: {},
          }),
        );
      }
    });
  });

  // ─── Empty-data handling ───────────────────────────────────────────────────

  describe('empty data handling', () => {
    it('skips persistence and logs a warning when eventId is empty', async () => {
      const warnSpy = jest
        .spyOn((worker as any).logger, 'warn')
        .mockImplementation(() => {});
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);

      await handler(
        makeJob<PoolCreatedJobData>({
          eventId: '',
          poolId: 'pool-abc',
          tokenA: 'XLM',
          tokenB: 'USDC',
          fee: '30',
          sqrtPriceX96: '79228162514264337593543950336',
        }),
      );

      expect(mockPrismaClient.poolCreated.upsert).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('eventId'));
      warnSpy.mockRestore();
    });

    it('skips persistence and logs a warning when poolId is empty', async () => {
      const warnSpy = jest
        .spyOn((worker as any).logger, 'warn')
        .mockImplementation(() => {});
      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);

      await handler(
        makeJob<SwapProcessedJobData>({
          eventId: 'evt-1',
          poolId: '',
          sender: '0xSender',
          recipient: '0xRecipient',
          amount0: '1000',
          amount1: '500',
          sqrtPriceX96: '79228162514264337593543950336',
          liquidity: '1000000',
          tick: 0,
        }),
      );

      expect(mockPrismaClient.swapProcessed.upsert).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('poolId'));
      warnSpy.mockRestore();
    });

    it('skips persistence when FeesCollected recipient is empty', async () => {
      const warnSpy = jest
        .spyOn((worker as any).logger, 'warn')
        .mockImplementation(() => {});
      const handler = getHandlerForQueue(QUEUE_NAMES.FEES_COLLECTED);

      await handler(
        makeJob<FeesCollectedJobData>({
          eventId: 'evt-fees-empty',
          poolId: 'pool-abc',
          recipient: '',
          amount0: '5000',
          amount1: '2500',
        }),
      );

      expect(mockPrismaClient.feesCollected.upsert).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Check the upstream event emitter'),
      );
      warnSpy.mockRestore();
    });

    it('processes normally when all fields are present', async () => {
      const handler = getHandlerForQueue(QUEUE_NAMES.FEES_COLLECTED);

      await handler(
        makeJob<FeesCollectedJobData>({
          eventId: 'evt-fees-ok',
          poolId: 'pool-abc',
          recipient: '0xRecipient',
          amount0: '5000',
          amount1: '2500',
        }),
      );

      expect(mockPrismaClient.feesCollected.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('error propagation', () => {
    it('propagates Prisma errors from handlePoolCreated', async () => {
      mockPrismaClient.poolCreated.upsert.mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      await expect(
        handler(
          makeJob<PoolCreatedJobData>({
            eventId: 'evt-err',
            poolId: 'pool-err',
            tokenA: 'XLM',
            tokenB: 'USDC',
            fee: '30',
            sqrtPriceX96: '0',
          }),
        ),
      ).rejects.toThrow('DB connection lost');

      expect(mockSetMaxNumber).not.toHaveBeenCalled();
    });

    it('propagates Prisma errors from handleSwapProcessed', async () => {
      mockPrismaClient.swapProcessed.upsert.mockRejectedValueOnce(
        new Error('Unique constraint violation'),
      );

      const handler = getHandlerForQueue(QUEUE_NAMES.SWAP_PROCESSED);
      await expect(
        handler(
          makeJob<SwapProcessedJobData>({
            eventId: 'evt-err',
            poolId: 'pool-err',
            sender: '0x1',
            recipient: '0x2',
            amount0: '0',
            amount1: '0',
            sqrtPriceX96: '0',
            liquidity: '0',
            tick: 0,
          }),
        ),
      ).rejects.toThrow('Unique constraint violation');
    });
  });

  describe('ledger checkpoint validation', () => {
    it('replays safely after a failed write without advancing the checkpoint early', async () => {
      mockPrismaClient.poolCreated.upsert.mockRejectedValueOnce(
        new Error('worker crashed before acknowledgement'),
      );
      const handler = getHandlerForQueue(QUEUE_NAMES.POOL_CREATED);
      const job = makeJob({
        eventId: 'evt-replayed',
        poolId: 'pool',
        tokenA: 'A',
        tokenB: 'B',
        fee: '1',
        sqrtPriceX96: '1',
        ledger: 500,
      });

      await expect(handler(job)).rejects.toThrow('worker crashed');
      expect(mockSetMaxNumber).not.toHaveBeenCalled();

      await expect(handler(job)).resolves.toBeUndefined();
      expect(mockPrismaClient.poolCreated.upsert).toHaveBeenCalledTimes(2);
      expect(mockSetMaxNumber).toHaveBeenCalledWith(
        LAST_INDEXED_LEDGER_KEY,
        500,
      );
    });

    it('does not persist an invalid ledger checkpoint', async () => {
      const warnSpy = jest
        .spyOn((worker as any).logger, 'warn')
        .mockImplementation(() => {});
      const handler = getHandlerForQueue(QUEUE_NAMES.FEES_COLLECTED);

      await handler(
        makeJob({
          eventId: 'evt-invalid-ledger',
          poolId: 'pool-abc',
          recipient: '0xRecipient',
          amount0: '1',
          amount1: '2',
          ledger: -1,
        }),
      );

      expect(mockPrismaClient.feesCollected.upsert).toHaveBeenCalledTimes(1);
      expect(mockSetMaxNumber).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid ledger'),
      );
      warnSpy.mockRestore();
    });
  });
});
