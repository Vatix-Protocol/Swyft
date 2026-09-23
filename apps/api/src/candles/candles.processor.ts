import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, Job, ConnectionOptions } from 'bullmq';
import { CandlesService, CandleInterval } from './candles.service';

export const CANDLES_QUEUE = 'candle-aggregation';
const REDIS_CONNECTION: ConnectionOptions = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

/**
 * Stable error codes for candle processing. Surfaced in logs/metrics so ops can
 * alert on a specific failure mode without parsing free-form messages.
 */
export const CANDLE_ERROR_CODES = {
  DEPENDENCY_UNAVAILABLE: 'CANDLE_DEPENDENCY_UNAVAILABLE',
  GAP_POLICY_VIOLATION: 'CANDLE_GAP_POLICY_VIOLATION',
  INVALID_INTERVAL: 'CANDLE_INVALID_INTERVAL',
} as const;
export type CandleErrorCode =
  (typeof CANDLE_ERROR_CODES)[keyof typeof CANDLE_ERROR_CODES];

/**
 * CANDLE_GAP_POLICY (see docs/CANDLE_GAP_POLICY.md).
 *
 * A candle bucket is only considered "closed" once its window has fully
 * elapsed. Any bucket whose window has closed but which has no aggregated
 * candle is a gap. Gaps are fail-closed: we never emit a synthetic/zero candle
 * for a closed bucket, and we never advance the aggregation cursor past a gap
 * until it has been explicitly backfilled. This keeps downstream
 * liquidity/trading/settlement consumers from acting on fabricated prices.
 */
export interface CandleGapPolicy {
  /** Max number of consecutive missing closed buckets tolerated before failing. */
  maxConsecutiveGaps: number;
  /** Whether a closed bucket with no trades may be emitted as a flat candle. */
  allowEmptyClosedBucket: boolean;
}

export const DEFAULT_CANDLE_GAP_POLICY: CandleGapPolicy = {
  maxConsecutiveGaps: 0,
  allowEmptyClosedBucket: false,
};

interface CandleJobData {
  interval: CandleInterval;
  /** Idempotency key: replayed/concurrent jobs with the same key are coalesced. */
  correlationId: string;
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

const VALID_INTERVALS: ReadonlySet<CandleInterval> = new Set(
  SCHEDULES.map((s) => s.interval),
);

/**
 * Typed error carrying a stable code + correlation id. Never includes secrets
 * or raw dependency payloads.
 */
export class CandleProcessingError extends Error {
  constructor(
    readonly code: CandleErrorCode,
    readonly correlationId: string,
    message: string,
  ) {
    super(message);
    this.name = 'CandleProcessingError';
  }
}

@Injectable()
export class CandlesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandlesWorker.name);
  private worker!: Worker<CandleJobData, void>;
  private readonly gapPolicy: CandleGapPolicy = DEFAULT_CANDLE_GAP_POLICY;
  private readonly queue = new Queue<CandleJobData, void>(CANDLES_QUEUE, {
    connection: REDIS_CONNECTION,
  });

  constructor(private readonly service: CandlesService) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<CandleJobData, void>(
      CANDLES_QUEUE,
      (job: Job<CandleJobData>): Promise<void> => this.process(job),
      { connection: REDIS_CONNECTION },
    );
    this.worker.on('completed', (job: Job<CandleJobData>) => {
      this.logger.log(
        `candle job completed interval=${job.data.interval} correlationId=${job.data.correlationId}`,
      );
    });
    this.worker.on(
      'failed',
      (job: Job<CandleJobData> | undefined, err: Error) => {
        const code =
          err instanceof CandleProcessingError
            ? err.code
            : CANDLE_ERROR_CODES.DEPENDENCY_UNAVAILABLE;
        this.logger.warn(
          `candle job failed code=${code} interval=${job?.data.interval} correlationId=${job?.data.correlationId} err=${err.message}`,
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
        { interval, correlationId: `schedule-${interval}` },
        { repeat: { pattern: cron }, jobId: `candle-${interval}` },
      );
    }

    this.logger.log('Candle aggregation worker started');
  }

  /**
   * Process a single candle aggregation job.
   *
   * - Validates the interval (adversarial input) before touching dependencies.
   * - Enforces the gap policy fail-closed: a policy violation aborts the job
   *   rather than emitting a fabricated candle.
   * - Dependency outages (RPC/DB/Redis) surface as DEPENDENCY_UNAVAILABLE and
   *   the job is retried by BullMQ; we never advance state on a failed write.
   */
  private async process(job: Job<CandleJobData>): Promise<void> {
    const { interval, correlationId } = job.data;

    if (!VALID_INTERVALS.has(interval)) {
      throw new CandleProcessingError(
        CANDLE_ERROR_CODES.INVALID_INTERVAL,
        correlationId,
        `unsupported candle interval=${String(interval)}`,
      );
    }

    try {
      const result = await this.service.aggregate(interval);
      this.assertGapPolicy(result, correlationId);
    } catch (err) {
      if (err instanceof CandleProcessingError) {
        throw err;
      }
      // Fail-closed: dependency outage or unexpected error. Do not swallow.
      throw new CandleProcessingError(
        CANDLE_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        correlationId,
        err instanceof Error ? err.message : 'candle aggregation failed',
      );
    }
  }

  /**
   * Enforce CANDLE_GAP_POLICY on the aggregation result. The service reports
   * the number of consecutive missing closed buckets it observed; anything
   * beyond the policy threshold is a hard failure (fail-closed).
   */
  private assertGapPolicy(
    result: { consecutiveGaps?: number } | void,
    correlationId: string,
  ): void {
    const gaps = result?.consecutiveGaps ?? 0;
    if (gaps > this.gapPolicy.maxConsecutiveGaps) {
      throw new CandleProcessingError(
        CANDLE_ERROR_CODES.GAP_POLICY_VIOLATION,
        correlationId,
        `candle gap policy violated: ${gaps} consecutive gaps > ${this.gapPolicy.maxConsecutiveGaps}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
