import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, Job, ConnectionOptions } from 'bullmq';
import { CandlesService, CandleInterval } from './candles.service';
import { CANDLES_QUEUE_NAME } from '../indexer/queues';

const REDIS_CONNECTION: ConnectionOptions = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

interface CandleJobData {
  interval: CandleInterval;
}

interface CandleSchedule {
  interval: CandleInterval;
  cron: string;
}

const SCHEDULES: CandleSchedule[] = [
  { interval: '1m', cron: '* * * * *' },
  { interval: '5m', cron: '*/5 * * * *' },
  { interval: '1h', cron: '0 * * * *' },
  { interval: '1d', cron: '0 0 * * *' },
];

@Injectable()
export class CandlesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandlesWorker.name);
  private worker!: Worker<CandleJobData, void>;
  private readonly queue = new Queue<CandleJobData, void>(CANDLES_QUEUE_NAME, {
    connection: REDIS_CONNECTION,
  });
  private _isShuttingDown = false;
  /** Bounds how long a SIGTERM/SIGINT shutdown waits for an in-flight candle job before giving up. */
  private static readonly SHUTDOWN_TIMEOUT_MS = Number(
    process.env.CANDLES_SHUTDOWN_TIMEOUT_MS ?? 25_000,
  );

  constructor(private readonly service: CandlesService) {}

  /** True from the moment a shutdown signal is received until cleanup finishes. */
  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<CandleJobData, void>(
      CANDLES_QUEUE_NAME,
      (job: Job<CandleJobData>): Promise<void> =>
        this.service.aggregate(job.data.interval),
      { connection: REDIS_CONNECTION },
    );
    this.worker.on('completed', (job: Job<CandleJobData>) => {
      this.logger.log(`candle job completed interval=${job.data.interval}`);
    });
    this.worker.on(
      'failed',
      (job: Job<CandleJobData> | undefined, err: Error) => {
        this.logger.warn(
          `candle job failed interval=${job?.data.interval} err=${err.message}`,
        );
      },
    );

    // Clear stale repeatable jobs and re-register
    const existing = await this.queue.getRepeatableJobs();
    await Promise.all(
      existing.map((j) => this.queue.removeRepeatableByKey(j.key)),
    );

    // Backfill in schedule order so 1h candles have their 5m buckets ready.
    for (const { interval } of SCHEDULES) {
      await this.service.backfill(interval);
    }

    for (const { interval, cron } of SCHEDULES) {
      await this.queue.add(
        interval,
        { interval },
        { repeat: { pattern: cron }, jobId: `candle-${interval}` },
      );
    }

    this.logger.log('Candle aggregation worker started');
  }

  /**
   * Invoked by Nest's shutdown hooks on SIGTERM/SIGINT (see main.ts's
   * `enableShutdownHooks()`). `Worker#close()` stops routing new jobs
   * immediately but, unforced, waits for the active job to finish — so a
   * candle aggregation already writing its upserts is allowed to complete
   * rather than being cut off mid-period. Each `priceCandle` write is a
   * single upsert of the fully-computed OHLCV row, so there is no
   * intermediate/partial row to corrupt even if the job is interrupted
   * between pools; a re-run recomputes the period from source data instead
   * of accumulating onto a half-written row. Bounded by SHUTDOWN_TIMEOUT_MS
   * so a stuck job cannot hang the process past its deploy platform's kill
   * timeout.
   */
  async onModuleDestroy(): Promise<void> {
    this._isShuttingDown = true;
    this.logger.log(
      `Received shutdown signal — draining in-flight candle job (timeout ${CandlesWorker.SHUTDOWN_TIMEOUT_MS}ms)`,
    );

    // `worker` is only assigned once onModuleInit completes; a SIGTERM
    // during startup can invoke this hook first, so guard against closing
    // an unset worker.
    await this.withTimeout(
      Promise.all([this.worker?.close(), this.queue.close()]),
      CandlesWorker.SHUTDOWN_TIMEOUT_MS,
      'Timed out waiting for candle worker to drain in-flight job — forcing shutdown',
    );

    this._isShuttingDown = false;
    this.logger.log('Candle aggregation worker shut down gracefully');
  }

  /** Races `promise` against a timeout, logging (but not throwing) if the timeout wins. */
  private async withTimeout(
    promise: Promise<unknown>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<void> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(timeoutMessage);
        resolve();
      }, timeoutMs);
    });

    await Promise.race([promise.then(() => undefined), timeout]);
    clearTimeout(timer!);
  }
}
