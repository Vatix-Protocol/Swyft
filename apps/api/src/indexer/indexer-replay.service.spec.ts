jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    poolCreated: { findMany: jest.fn().mockResolvedValue([]) },
    swapProcessed: { findMany: jest.fn().mockResolvedValue([]) },
    positionMinted: { findMany: jest.fn().mockResolvedValue([]) },
    positionBurned: { findMany: jest.fn().mockResolvedValue([]) },
    feesCollected: { findMany: jest.fn().mockResolvedValue([]) },
    $disconnect: jest.fn(),
  })),
}));

import { QUEUE_NAMES } from './queues';
import { IndexerReplayService } from './indexer-replay.service';

describe('IndexerReplayService — dead-letter replay', () => {
  const poolCreatedQueue = { add: jest.fn().mockResolvedValue({ id: '1' }) };
  const swapProcessedQueue = { add: jest.fn().mockResolvedValue({ id: '2' }) };
  const positionMintedQueue = { add: jest.fn().mockResolvedValue({ id: '3' }) };
  const positionBurnedQueue = { add: jest.fn().mockResolvedValue({ id: '4' }) };
  const feesCollectedQueue = { add: jest.fn().mockResolvedValue({ id: '5' }) };

  const deadLetterService = {
    getDeadLetters: jest.fn(),
    getDeadLetter: jest.fn(),
    clearDeadLetter: jest.fn().mockResolvedValue(undefined),
  };

  const buildService = () =>
    new IndexerReplayService(
      poolCreatedQueue as never,
      swapProcessedQueue as never,
      positionMintedQueue as never,
      positionBurnedQueue as never,
      feesCollectedQueue as never,
      deadLetterService as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('re-enqueues a DLQ swap and marks it recovered', async () => {
    deadLetterService.getDeadLetter.mockResolvedValue({
      jobId: 'job-swap-1',
      queueName: QUEUE_NAMES.SWAP_PROCESSED,
      eventId: 'evt-swap-1',
      data: {
        eventId: 'evt-swap-1',
        poolId: 'pool-1',
        sender: 'S',
        recipient: 'R',
        amount0: '1',
        amount1: '2',
        sqrtPriceX96: '1',
        liquidity: '1',
        tick: 0,
      },
      error: 'boom',
      attemptsMade: 3,
    });

    const summary = await buildService().replayDeadLetters('job-swap-1');

    expect(swapProcessedQueue.add).toHaveBeenCalledWith(
      'evt-swap-1',
      expect.objectContaining({ eventId: 'evt-swap-1' }),
      expect.objectContaining({ jobId: 'dlq-replay:job-swap-1' }),
    );
    expect(deadLetterService.clearDeadLetter).toHaveBeenCalledWith(
      'job-swap-1',
    );
    expect(summary).toEqual({
      replayed: ['job-swap-1'],
      skipped: [],
      total: 1,
    });
  });

  it('treats a second replay of the same DLQ jobId as an idempotent no-op', async () => {
    deadLetterService.getDeadLetter.mockResolvedValue({
      jobId: 'job-swap-1',
      queueName: QUEUE_NAMES.SWAP_PROCESSED,
      eventId: 'evt-swap-1',
      data: { eventId: 'evt-swap-1', poolId: 'pool-1' },
      error: 'boom',
      attemptsMade: 3,
    });

    swapProcessedQueue.add
      .mockResolvedValueOnce({ id: '2' })
      .mockRejectedValueOnce(new Error('Job with this id already exists'));

    const service = buildService();
    await service.replayDeadLetters('job-swap-1');
    const second = await service.replayDeadLetters('job-swap-1');

    expect(swapProcessedQueue.add).toHaveBeenCalledTimes(2);
    expect(second.replayed).toEqual(['job-swap-1']);
    expect(second.skipped).toEqual([]);
    expect(deadLetterService.clearDeadLetter).toHaveBeenCalledTimes(2);
  });

  it('replays all unrecovered DLQ entries when jobId is omitted', async () => {
    deadLetterService.getDeadLetters.mockResolvedValue([
      {
        jobId: 'job-pool-1',
        queueName: QUEUE_NAMES.POOL_CREATED,
        eventId: 'evt-pool-1',
        data: {
          eventId: 'evt-pool-1',
          poolId: 'p',
          tokenA: 'A',
          tokenB: 'B',
          fee: '1',
          sqrtPriceX96: '1',
        },
        error: 'boom',
        attemptsMade: 3,
      },
    ]);

    const summary = await buildService().replayDeadLetters();

    expect(deadLetterService.getDeadLetters).toHaveBeenCalledWith(
      undefined,
      500,
      true,
    );
    expect(poolCreatedQueue.add).toHaveBeenCalled();
    expect(summary.total).toBe(1);
  });
});
