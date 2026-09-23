// ─── BullMQ mocks ───────────────────────────────────────────────────────────
// Mock the entire bullmq module so no Redis connection is needed in unit tests.

const mockWorkerOn = jest.fn();
let mockWorkerClose = jest.fn().mockResolvedValue(undefined);

const MockWorker = jest.fn().mockImplementation(() => ({
  on: mockWorkerOn,
  close: (...args: unknown[]) => mockWorkerClose(...args),
}));

let mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockGetRepeatableJobs = jest.fn().mockResolvedValue([]);
const mockRemoveRepeatableByKey = jest.fn().mockResolvedValue(undefined);

const MockQueue = jest.fn().mockImplementation(() => ({
  close: (...args: unknown[]) => mockQueueClose(...args),
  add: mockQueueAdd,
  getRepeatableJobs: mockGetRepeatableJobs,
  removeRepeatableByKey: mockRemoveRepeatableByKey,
}));

jest.mock('bullmq', () => ({
  Worker: MockWorker,
  Queue: MockQueue,
  Job: jest.fn(),
}));

// ─── Imports (after mocks are set up) ──────────────────────────────────────

import { CandlesWorker } from './candles.processor';
import { CandlesService } from './candles.service';
import { CANDLES_QUEUE_NAME } from '../indexer/queues';

// The worker's shutdown timeout is read from CANDLES_SHUTDOWN_TIMEOUT_MS at
// module-load time (a static field), so it's fixed to the 25s default for
// this whole test file regardless of env changes made inside a test.
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

describe('CandlesWorker', () => {
  let worker: CandlesWorker;
  let service: { aggregate: jest.Mock; backfill: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerClose = jest.fn().mockResolvedValue(undefined);
    mockQueueClose = jest.fn().mockResolvedValue(undefined);
    service = {
      aggregate: jest.fn().mockResolvedValue(undefined),
      backfill: jest.fn().mockResolvedValue(undefined),
    };
    worker = new CandlesWorker(service as unknown as CandlesService);
  });

  it('creates the BullMQ Queue under the centralized candle queue name', () => {
    // The Queue is constructed as a class field, so it exists immediately.
    expect(MockQueue).toHaveBeenCalledWith(
      CANDLES_QUEUE_NAME,
      expect.any(Object),
    );
  });

  it('creates the BullMQ Worker under the centralized candle queue name on init', async () => {
    await worker.onModuleInit();

    expect(MockWorker).toHaveBeenCalledWith(
      CANDLES_QUEUE_NAME,
      expect.any(Function),
      expect.any(Object),
    );
  });

  describe('onModuleDestroy()', () => {
    it('closes both the worker and the queue', async () => {
      await worker.onModuleInit();
      await worker.onModuleDestroy();

      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
    });

    it('reports isShuttingDown while draining and clears it once done', async () => {
      let resolveClose!: () => void;
      mockWorkerClose = jest.fn(
        () => new Promise<void>((resolve) => (resolveClose = resolve)),
      );
      await worker.onModuleInit();

      expect(worker.isShuttingDown).toBe(false);
      const shutdown = worker.onModuleDestroy();
      // Give the microtask queue a turn so onModuleDestroy has set the flag.
      await Promise.resolve();
      expect(worker.isShuttingDown).toBe(true);

      resolveClose();
      await shutdown;
      expect(worker.isShuttingDown).toBe(false);
    });

    it('forces shutdown after the timeout instead of hanging on a stuck close()', async () => {
      jest.useFakeTimers();

      // A worker.close() that never resolves simulates a stuck in-flight job.
      mockWorkerClose = jest.fn(() => new Promise<void>(() => {}));
      await worker.onModuleInit();

      const shutdown = worker.onModuleDestroy();
      const settled = jest.fn();
      void shutdown.then(settled);

      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS);
      expect(settled).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('does not throw when SIGTERM arrives before onModuleInit has run', async () => {
      // A process can receive SIGTERM during startup, before the BullMQ
      // Worker is constructed — onModuleDestroy must still close the queue
      // cleanly instead of crashing on an unset worker.
      await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
    });
  });
});
