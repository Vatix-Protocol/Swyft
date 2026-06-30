/**
 * Indexer worker integration tests using an in-memory Prisma mock that
 * simulates the shape of a real test database. These tests verify that the
 * worker correctly persists events, updates pool/swap state, and advances
 * ledger checkpoints — without requiring a live PostgreSQL instance.
 */

// ─── BullMQ mocks ─────────────────────────────────────────────────────────────

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

jest.mock('bullmq', () => ({
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Job: jest.fn(),
}));

// ─── In-memory test DB (Prisma mock) ──────────────────────────────────────────

interface PoolRow {
  id: string;
  token0Address: string;
  token1Address: string;
  feeTier: number;
  currentSqrtPrice: string;
  currentTick: number;
  liquidity: string;
  tvl: string;
  volume24h: string;
  feeApr: string;
  updatedAt?: Date;
  createdAt?: Date;
}

interface SwapRow {
  id?: string;
  eventId: string;
  poolId: string;
  senderAddress: string;
  recipientAddress: string;
  amount0: string;
  amount1: string;
  sqrtPriceAfter: string;
  tickAfter: number;
  transactionHash: string;
  feeAmount?: string;
  timestamp?: Date;
}

interface TokenRow {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

const db: {
  pools: Map<string, PoolRow>;
  swaps: Map<string, SwapRow>;
  tokens: Map<string, TokenRow>;
  poolCreated: Map<string, unknown>;
  swapProcessed: Map<string, unknown>;
  positionMinted: Map<string, unknown>;
  positionBurned: Map<string, unknown>;
  feesCollected: Map<string, unknown>;
  positions: Map<string, unknown>;
} = {
  pools: new Map(),
  swaps: new Map(),
  tokens: new Map(),
  poolCreated: new Map(),
  swapProcessed: new Map(),
  positionMinted: new Map(),
  positionBurned: new Map(),
  feesCollected: new Map(),
  positions: new Map(),
};

function makeUpsert<T extends Record<string, unknown>>(
  store: Map<string, T>,
  keyFn: (where: Record<string, unknown>) => string,
) {
  return jest.fn().mockImplementation(async ({ where, create, update }: {
    where: Record<string, unknown>;
    create: T;
    update: Partial<T>;
  }) => {
    const key = keyFn(where);
    if (store.has(key)) {
      const existing = store.get(key)!;
      const merged = { ...existing, ...update } as T;
      store.set(key, merged);
      return merged;
    }
    store.set(key, create);
    return create;
  });
}

const mockPrismaClient = {
  token: {
    upsert: makeUpsert(db.tokens as Map<string, Record<string, unknown>>, (w) => w.address as string),
  },
  pool: {
    upsert: makeUpsert(db.pools as Map<string, Record<string, unknown>>, (w) => w.id as string),
    findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
      return db.pools.get(where.id) ?? null;
    }),
  },
  swap: {
    upsert: makeUpsert(db.swaps as Map<string, Record<string, unknown>>, (w) => w.eventId as string),
  },
  position: {
    upsert: makeUpsert(db.positions as Map<string, Record<string, unknown>>, (w) => {
      const pk = w.poolId_tokenId as { poolId: string; tokenId: string };
      return `${pk.poolId}:${pk.tokenId}`;
    }),
    update: jest.fn().mockResolvedValue({}),
  },
  poolCreated: {
    upsert: makeUpsert(db.poolCreated as Map<string, Record<string, unknown>>, (w) => w.eventId as string),
  },
  swapProcessed: {
    upsert: makeUpsert(db.swapProcessed as Map<string, Record<string, unknown>>, (w) => w.eventId as string),
  },
  positionMinted: {
    upsert: makeUpsert(db.positionMinted as Map<string, Record<string, unknown>>, (w) => w.eventId as string),
  },
  positionBurned: {
    upsert: makeUpsert(db.positionBurned as Map<string, Record<string, unknown>>, (w) => w.eventId as string),
  },
  feesCollected: {
    upsert: makeUpsert(db.feesCollected as Map<string, Record<string, unknown>>, (w) => w.eventId as string),
  },
  $disconnect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrismaClient),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { IndexerWorker } from './indexer.worker';
import { CacheService } from '../cache/cache.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TokenEnrichmentService } from '../tokens/token-enrichment.service';
import { LAST_INDEXED_LEDGER_KEY } from '../metrics/indexer-monitor.service';
import { QUEUE_NAMES } from './queues';
import type {
  PoolCreatedJobData,
  SwapProcessedJobData,
  FeesCollectedJobData,
  PositionMintedJobData,
  PositionBurnedJobData,
} from './queues';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob<T>(data: T): Job<T> {
  return { data, id: 'integration-job', attemptsMade: 1 } as unknown as Job<T>;
}

function getHandler(queueName: string): (job: Job<unknown>) => Promise<void> {
  const call = MockWorker.mock.calls.find((c) => c[0] === queueName);
  if (!call) throw new Error(`No worker for queue: ${queueName}`);
  return call[1] as (job: Job<unknown>) => Promise<void>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IndexerWorker Integration (test-db)', () => {
  let worker: IndexerWorker;
  let module: TestingModule;
  const mockSetMaxNumber = jest.fn().mockResolvedValue(true);

  beforeEach(async () => {
    jest.clearAllMocks();
    db.pools.clear();
    db.swaps.clear();
    db.tokens.clear();
    db.poolCreated.clear();
    db.swapProcessed.clear();
    db.positionMinted.clear();
    db.positionBurned.clear();
    db.feesCollected.clear();
    db.positions.clear();

    module = await Test.createTestingModule({
      providers: [
        IndexerWorker,
        {
          provide: CacheService,
          useValue: { setMaxNumber: mockSetMaxNumber },
        },
        {
          provide: WebhooksService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: TokenEnrichmentService,
          useValue: { enrichToken: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    worker = module.get<IndexerWorker>(IndexerWorker);
    worker.onModuleInit();
  });

  afterEach(async () => {
    await module.close();
  });

  describe('pool.created flow', () => {
    const poolData: PoolCreatedJobData = {
      eventId: 'int-pool-1',
      poolId: 'pool-integration-1',
      tokenA: 'XLM',
      tokenB: 'USDC',
      fee: '3000',
      sqrtPriceX96: '79228162514264337593543950336',
      ledger: 1000,
    };

    it('persists PoolCreated event to test db', async () => {
      const handler = getHandler(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(poolData));

      expect(db.poolCreated.has('int-pool-1')).toBe(true);
    });

    it('creates token rows for both pool tokens', async () => {
      const handler = getHandler(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(poolData));

      expect(db.tokens.has('XLM')).toBe(true);
      expect(db.tokens.has('USDC')).toBe(true);
    });

    it('creates a pool row with correct fee tier', async () => {
      const handler = getHandler(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(poolData));

      const pool = db.pools.get('pool-integration-1') as PoolRow;
      expect(pool).toBeDefined();
      expect(pool.feeTier).toBe(3000);
      expect(pool.token0Address).toBe('XLM');
      expect(pool.token1Address).toBe('USDC');
    });

    it('advances ledger checkpoint after successful write', async () => {
      const handler = getHandler(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(poolData));

      expect(mockSetMaxNumber).toHaveBeenCalledWith(LAST_INDEXED_LEDGER_KEY, 1000);
    });

    it('is idempotent: duplicate event does not create duplicate rows', async () => {
      const handler = getHandler(QUEUE_NAMES.POOL_CREATED);
      await handler(makeJob(poolData));
      await handler(makeJob(poolData));

      expect(db.poolCreated.size).toBe(1);
    });
  });

  describe('swap.processed flow', () => {
    const swapData: SwapProcessedJobData = {
      eventId: 'int-swap-1',
      poolId: 'pool-integration-1',
      sender: '0xSender',
      recipient: '0xRecipient',
      amount0: '1000000',
      amount1: '-500000',
      sqrtPriceX96: '79228162514264337593543950336',
      liquidity: '1000000000000000000',
      tick: 100,
      ledger: 1001,
    };

    it('persists SwapProcessed event to test db', async () => {
      const handler = getHandler(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(swapData));

      expect(db.swapProcessed.has('int-swap-1')).toBe(true);
    });

    it('creates a Swap row in test db', async () => {
      const handler = getHandler(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(swapData));

      expect(db.swaps.has('int-swap-1')).toBe(true);
      const swap = db.swaps.get('int-swap-1') as SwapRow;
      expect(swap.poolId).toBe('pool-integration-1');
      expect(swap.tickAfter).toBe(100);
    });

    it('creates a placeholder pool when it does not exist yet', async () => {
      const handler = getHandler(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(swapData));

      const pool = db.pools.get('pool-integration-1') as PoolRow;
      expect(pool).toBeDefined();
      expect(pool.currentTick).toBe(100);
    });

    it('updates existing pool state on swap', async () => {
      db.pools.set('pool-integration-1', {
        id: 'pool-integration-1',
        token0Address: 'XLM',
        token1Address: 'USDC',
        feeTier: 3000,
        currentSqrtPrice: '1',
        currentTick: 0,
        liquidity: '0',
        tvl: '0',
        volume24h: '0',
        feeApr: '0',
      });

      const handler = getHandler(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(swapData));

      const pool = db.pools.get('pool-integration-1') as PoolRow;
      expect(pool.currentTick).toBe(100);
      expect(pool.liquidity).toBe('1000000000000000000');
    });

    it('advances ledger checkpoint after swap write', async () => {
      const handler = getHandler(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob(swapData));

      expect(mockSetMaxNumber).toHaveBeenCalledWith(LAST_INDEXED_LEDGER_KEY, 1001);
    });

    it('skips invalid sqrtPrice but still persists swap row', async () => {
      const handler = getHandler(QUEUE_NAMES.SWAP_PROCESSED);
      await handler(makeJob({ ...swapData, sqrtPriceX96: '0', eventId: 'int-swap-invalid' }));

      expect(db.swaps.has('int-swap-invalid')).toBe(true);
    });
  });

  describe('fees.collected flow', () => {
    const feesData: FeesCollectedJobData = {
      eventId: 'int-fees-1',
      poolId: 'pool-integration-1',
      recipient: '0xRecipient',
      amount0: '5000',
      amount1: '2500',
      ledger: 1002,
    };

    it('persists FeesCollected event to test db', async () => {
      const handler = getHandler(QUEUE_NAMES.FEES_COLLECTED);
      await handler(makeJob(feesData));

      expect(db.feesCollected.has('int-fees-1')).toBe(true);
    });

    it('advances ledger checkpoint after fees write', async () => {
      const handler = getHandler(QUEUE_NAMES.FEES_COLLECTED);
      await handler(makeJob(feesData));

      expect(mockSetMaxNumber).toHaveBeenCalledWith(LAST_INDEXED_LEDGER_KEY, 1002);
    });
  });

  describe('position.minted flow', () => {
    const mintData: PositionMintedJobData = {
      eventId: 'int-mint-1',
      poolId: 'pool-integration-1',
      tokenId: 'tok-1',
      owner: '0xOwner',
      tickLower: -1000,
      tickUpper: 1000,
      liquidity: '500000000',
      amount0: '100000',
      amount1: '200000',
      ledger: 1003,
    };

    it('persists PositionMinted event to test db', async () => {
      const handler = getHandler(QUEUE_NAMES.POSITION_MINTED);
      await handler(makeJob(mintData));

      expect(db.positionMinted.has('int-mint-1')).toBe(true);
    });

    it('upserts Position row by pool and token id', async () => {
      const handler = getHandler(QUEUE_NAMES.POSITION_MINTED);
      await handler(makeJob(mintData));

      expect(db.positions.has('pool-integration-1:tok-1')).toBe(true);
    });
  });

  describe('position.burned flow', () => {
    const burnData: PositionBurnedJobData = {
      eventId: 'int-burn-1',
      poolId: 'pool-integration-1',
      tokenId: 'tok-1',
      owner: '0xOwner',
      tickLower: -1000,
      tickUpper: 1000,
      liquidity: '0',
      amount0: '100000',
      amount1: '200000',
      ledger: 1004,
    };

    it('persists PositionBurned event to test db', async () => {
      const handler = getHandler(QUEUE_NAMES.POSITION_BURNED);
      await handler(makeJob(burnData));

      expect(db.positionBurned.has('int-burn-1')).toBe(true);
    });

    it('marks zero-liquidity position as closed in test db', async () => {
      const handler = getHandler(QUEUE_NAMES.POSITION_BURNED);
      await handler(makeJob(burnData));

      expect(mockPrismaClient.position.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ closedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('graceful error handling', () => {
    it('does not advance ledger when Prisma write fails', async () => {
      mockPrismaClient.poolCreated.upsert.mockRejectedValueOnce(
        new Error('integration test db connection lost'),
      );

      const handler = getHandler(QUEUE_NAMES.POOL_CREATED);
      await expect(
        handler(
          makeJob<PoolCreatedJobData>({
            eventId: 'int-err-1',
            poolId: 'pool-err',
            tokenA: 'A',
            tokenB: 'B',
            fee: '30',
            sqrtPriceX96: '1',
            ledger: 9999,
          }),
        ),
      ).rejects.toThrow('integration test db connection lost');

      expect(mockSetMaxNumber).not.toHaveBeenCalled();
    });

    it('skips write and warns on empty eventId', async () => {
      const handler = getHandler(QUEUE_NAMES.FEES_COLLECTED);
      await handler(
        makeJob<FeesCollectedJobData>({
          eventId: '',
          poolId: 'pool-integration-1',
          recipient: '0xR',
          amount0: '1',
          amount1: '1',
        }),
      );

      expect(db.feesCollected.size).toBe(0);
    });
  });
});
