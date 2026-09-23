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
  /**
   * Pool the candle job is scoped to. Per-pool TWAP correctness requires that
   * aggregation never mixes state across pools, so the pool id is part of the
   * job payload and is validated before any write. Absent only for legacy
   * jobs enqueued before per-pool isolation landed; those are rejected
   * fail-closed rather than aggregated against an implicit pool.
   */
  poolId?: string;
  /** Correlation id propagated from the enqueuer for ops-safe tracing. */
  correlationId?: string;
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

/** Stable error codes surfaced for TWAP/candle job failures (see CONTRACTS.md). */
export const CANDLE_ERROR_CODES = {
  MISSING_POOL_ID: 'CANDLE_MISSING_POOL_ID',
  UNKNOWN_POOL: 'CANDLE_UNKNOWN_POOL',
  DEPENDENCY_UNAVAILABLE: 'CANDLE_DEPENDENCY_UNAVAILABLE',
} as const;

export type CandleErrorCode =
  (typeof CANDLE_ERROR_CODES)[keyof typeof CANDLE_ERROR_CODES];

/** Typed error carrying a stable code + correlation id for fail-closed handling. */
export class CandleJobError extends Error {
  constructor(
    readonly code: CandleErrorCode,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'CandleJobError';
  }
}

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
      (job: Job<CandleJobData>): Promise<void> => this.process(job),
      { connection: REDIS_CONNECTION },
    );
    this.worker.on('completed', (job: Job<CandleJobData>) => {
      this.logger.log(
        `candle job completed interval=${job.data.interval} pool=${job.data.poolId ?? 'n/a'} correlationId=${job.data.correlationId ?? 'n/a'}`,
      );
    });
    this.worker.on(
      'failed',
      (job: Job<CandleJobData> | undefined, err: Error) => {
        this.logger.warn(
          `candle job failed interval=${job?.data.interval} pool=${job?.data.poolId ?? 'n/a'} correlationId=${job?.data.correlationId ?? 'n/a'} err=${err.message}`,
        );
      },
    );

    // Clear stale repeatable jobs and re-register
    const existing = await this.queue.getRepeatableJobs();
    await Promise.all(
      existing.map((j) => this.queue.removeRepeatableByKey(j.key)),
    );

    // Backfill in schedule order so 1h candles have their 5m buckets ready.
    // Each pool is aggregated in isolation; a failure for one pool must not
    // silently aggregate another pool's state.
    const poolIds = await this.service.listPoolIds();
    for (const poolId of poolIds) {
      for (const { interval } of SCHEDULES) {
        await this.service.backfill(interval, poolId);
      }
    }

    for (const poolId of poolIds) {
      for (const { interval, cron } of SCHEDULES) {
        await this.queue.add(
          interval,
          { interval, poolId },
          {
            repeat: { pattern: cron },
            jobId: `candle-${poolId}-${interval}`,
          },
        );
      }
    }

    this.logger.log('Candle aggregation worker started');
  }

  /**
   * Validates and dispatches a single candle job. Fail-closed: a job without a
   * pool id, or for a pool the service does not recognize, is rejected with a
   * stable error code instead of being aggregated against an implicit pool.
   * Dependency outages (RPC/DB/Redis) surface as CANDLE_DEPENDENCY_UNAVAILABLE
   * so the job is retried rather than writing partial per-pool state.
   */
  private async process(job: Job<CandleJobData>): Promise<void> {
    const { interval, poolId, correlationId } = job.data;

    if (!poolId) {
      throw new CandleJobError(
        CANDLE_ERROR_CODES.MISSING_POOL_ID,
        'candle job rejected: missing poolId (per-pool isolation required)',
        correlationId,
      );
    }

    const known = await this.service.isKnownPool(poolId);
    if (!known) {
      throw new CandleJobError(
        CANDLE_ERROR_CODES.UNKNOWN_POOL,
        `candle job rejected: unknown pool ${poolId}`,
        correlationId,
      );
    }

    try {
      await this.service.aggregate(interval, poolId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CandleJobError(
        CANDLE_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        `candle aggregation failed for pool ${poolId}: ${message}`,
        correlationId,
      );
    }
  }

  /**
   * Invoked by Nest's shutdown hooks on SIGTERM/SIGINT (see main.ts's
   * `enableShutdownHooks()`). `Worker#close()` stops routing new jobs
   * immediately but, unforced, waits for the active job to finish — so a
   * candle aggregation already writing its upserts is allowed to complete
   * rather than being cut off mid-period. Each `priceCandle` write is a
   * single upsert of the fully-computed OHLCV row for one pool, so there is no
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
