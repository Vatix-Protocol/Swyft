import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { AnalyticsService } from './analytics.service';
import { makeQueueOptions } from '../indexer/queues';
import {
  analyticsSchedulerMetrics as metrics,
  classifyAnalyticsFailure,
} from './analytics-scheduler.metrics';

/**
 * Cardinality-safe analytics scheduler (#1031).
 *
 * Invariants:
 *  - One scheduler, fixed id: every API instance upserts the same
 *    ANALYTICS_SCHEDULER_ID, so N replicas produce one recompute per
 *    interval, not N. Worker concurrency is 1 so runs never overlap within
 *    an instance, and BullMQ hands each scheduled job to a single worker.
 *  - Bounded Redis footprint: completed and failed jobs are trimmed by count
 *    and age (failed jobs were previously kept forever).
 *  - Bounded metric cardinality: outcomes/failure reasons are fixed enums
 *    (see analytics-scheduler.metrics.ts); job ids and correlation ids only
 *    appear in logs.
 *  - Clamped interval: ANALYTICS_REFRESH_INTERVAL_MS is clamped to
 *    [1 min, 24 h] so a typo cannot hammer the DB or stall refreshes.
 *  - Kill switch: ANALYTICS_SCHEDULER_ENABLED=false starts no worker and
 *    removes the scheduler from Redis.
 *  - Fail-closed: a failed recompute throws (job marked failed) and the
 *    service never writes partial results; a Redis outage at boot leaves the
 *    scheduler `unavailable` without blocking the rest of the API.
 *  - No secrets in logs: errors are logged by name/code only, never by
 *    message or stack (Prisma/ioredis messages can carry connection info).
 *
 * Runbook: apps/api/README.md#analytics-scheduler.
 */
export const ANALYTICS_QUEUE_NAME = 'analytics.refresh';
export const ANALYTICS_JOB_NAME = 'recompute';
export const ANALYTICS_SCHEDULER_ID = 'analytics-refresh-scheduler';

export const DEFAULT_ANALYTICS_INTERVAL_MS = 15 * 60 * 1000;
export const MIN_ANALYTICS_INTERVAL_MS = 60 * 1000;
export const MAX_ANALYTICS_INTERVAL_MS = 24 * 60 * 60 * 1000;

const COMPLETED_RETENTION = { count: 5, age: 24 * 60 * 60 };
const FAILED_RETENTION = { count: 50, age: 7 * 24 * 60 * 60 };

export interface AnalyticsSchedulerConfig {
  enabled: boolean;
  everyMs: number;
}

export function resolveAnalyticsSchedulerConfig(
  env: Record<string, string | undefined> = process.env,
): AnalyticsSchedulerConfig {
  const flag = (env.ANALYTICS_SCHEDULER_ENABLED ?? '').trim().toLowerCase();
  const enabled = !['false', '0', 'off', 'no'].includes(flag);

  const raw = Number(env.ANALYTICS_REFRESH_INTERVAL_MS);
  const everyMs = Number.isInteger(raw) && raw > 0
    ? Math.min(Math.max(raw, MIN_ANALYTICS_INTERVAL_MS), MAX_ANALYTICS_INTERVAL_MS)
    : DEFAULT_ANALYTICS_INTERVAL_MS;

  return { enabled, everyMs };
}

@Injectable()
export class AnalyticsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsScheduler.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly analytics: AnalyticsService) {}

  async onModuleInit() {
    const config = resolveAnalyticsSchedulerConfig();
    metrics.intervalMs = config.everyMs;
    const opts = makeQueueOptions();
    this.queue = new Queue(ANALYTICS_QUEUE_NAME, opts);

    if (!config.enabled) {
      metrics.state = 'disabled';
      try {
        await this.queue.removeJobScheduler(ANALYTICS_SCHEDULER_ID);
      } catch (err) {
        this.logger.warn(
          `Analytics scheduler disabled; could not remove scheduler err=${(err as Error)?.name}`,
        );
      }
      this.logger.warn(
        'Analytics scheduler disabled via ANALYTICS_SCHEDULER_ENABLED',
      );
      return;
    }

    metrics.state = 'starting';
    this.worker = new Worker(ANALYTICS_QUEUE_NAME, (job) => this.process(job), {
      connection: opts.connection,
      concurrency: 1,
    });

    this.worker.on('failed', (job, err) => {
      const reason = classifyAnalyticsFailure(err);
      metrics.runs.inc('failure');
      metrics.failures.inc(reason);
      this.logger.error(
        `Analytics recompute failed jobId=${job?.id ?? 'unknown'} ` +
          `code=${reason} err=${err?.name ?? 'Error'}`,
      );
    });

    try {
      await this.queue.upsertJobScheduler(
        ANALYTICS_SCHEDULER_ID,
        { every: config.everyMs },
        {
          name: ANALYTICS_JOB_NAME,
          opts: {
            attempts: 1,
            removeOnComplete: COMPLETED_RETENTION,
            removeOnFail: FAILED_RETENTION,
          },
        },
      );
    } catch (err) {
      metrics.state = 'unavailable';
      this.logger.error(
        `Analytics scheduler could not be registered err=${(err as Error)?.name}`,
      );
      return;
    }

    metrics.state = 'running';
    this.logger.log(`Analytics scheduler started everyMs=${config.everyMs}`);
  }

  /** Worker processor; public for unit tests. */
  async process(job: Job): Promise<void> {
    if (job.name !== ANALYTICS_JOB_NAME) {
      // Only our scheduler should enqueue here; anything else is dropped
      // without retry so it cannot trigger extra recomputes.
      metrics.runs.inc('rejected_job');
      this.logger.warn(`Analytics queue dropped unexpected job jobId=${job.id}`);
      return;
    }

    const correlationId = `analytics-refresh:${job.id}`;
    const startedAt = Date.now();
    await this.analytics.recomputeAll(correlationId);
    metrics.lastDurationMs = Date.now() - startedAt;
    metrics.lastSuccessAt = new Date().toISOString();
    metrics.runs.inc('success');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    metrics.state = 'stopped';
  }
}
