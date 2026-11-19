import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { CandlesService } from './candles.service';
import { CANDLES_QUEUE_NAME } from '../indexer/queues';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

function resolveShutdownTimeoutMs(): number {
  const raw = process.env.CANDLES_SHUTDOWN_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

function resolveRedisConnection() {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD
      ? { password: process.env.REDIS_PASSWORD }
      : {}),
  };
}

@Injectable()
export class CandlesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandlesWorker.name);
  private readonly shutdownTimeoutMs = resolveShutdownTimeoutMs();
  private readonly queue: Queue;
  private worker?: Worker;
  private shuttingDown = false;

  constructor(private readonly candlesService: CandlesService) {
    this.queue = new Queue(CANDLES_QUEUE_NAME, {
      connection: resolveRedisConnection(),
    });
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      CANDLES_QUEUE_NAME,
      async (job: Job) => this.process(job),
      { connection: resolveRedisConnection() },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Candle job ${job?.id ?? 'unknown'} failed: ${err.message}`,
        err.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;

    try {
      if (this.worker) {
        await this.withTimeout(this.worker.close(), 'worker');
      }
    } catch (err) {
      this.logger.error(
        `Failed to close candle worker: ${(err as Error).message}`,
      );
    }

    try {
      await this.withTimeout(this.queue.close(), 'queue');
    } catch (err) {
      this.logger.error(
        `Failed to close candle queue: ${(err as Error).message}`,
      );
    } finally {
      this.shuttingDown = false;
    }
  }

  private async process(job: Job): Promise<void> {
    const { pool, timeframe, from, to } = job.data ?? {};

    if (from !== undefined && to !== undefined) {
      await this.candlesService.backfill(pool, timeframe, from, to);
      return;
    }

    await this.candlesService.aggregate(pool, timeframe);
  }

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.logger.warn(
          `Candle ${label} close timed out after ${this.shutdownTimeoutMs}ms; forcing shutdown`,
        );
        resolve(undefined as unknown as T);
      }, this.shutdownTimeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}
