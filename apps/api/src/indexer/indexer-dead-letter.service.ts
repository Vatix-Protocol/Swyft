import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface DeadLetterEntry {
  jobId: string;
  queueName: string;
  eventId: string;
  data: Record<string, unknown>;
  error: string;
  attemptsMade: number;
}

export type ReplayErrorCode =
  | 'DLQ_NOT_FOUND'
  | 'DLQ_ALREADY_RECOVERED'
  | 'DLQ_REPLAY_IN_PROGRESS'
  | 'DLQ_DEPENDENCY_UNAVAILABLE';

export interface ReplayRequest {
  jobId: string;
  /** Caller-supplied idempotency key; falls back to jobId when omitted. */
  idempotencyKey?: string;
  /** Correlation id propagated through logs/metrics; generated when absent. */
  correlationId?: string;
}

export interface ReplayResult {
  ok: boolean;
  jobId: string;
  correlationId: string;
  /** True when the request was deduped against an in-flight/completed replay. */
  deduplicated: boolean;
  errorCode?: ReplayErrorCode;
  message?: string;
}

/**
 * Callback invoked to actually re-enqueue a dead-lettered job. Injected by the
 * indexer module so this service stays free of queue transport concerns.
 */
export type ReplayDispatcher = (
  entry: DeadLetterEntry,
  correlationId: string,
) => Promise<void>;

@Injectable()
export class IndexerDeadLetterService {
  private readonly logger = new Logger(IndexerDeadLetterService.name);
  private readonly prisma = new PrismaClient();

  /**
   * In-flight replay dedupe map keyed by idempotency key. Guards against
   * concurrent/replayed replay requests before the DB write commits.
   */
  private readonly inFlightReplays = new Map<string, Promise<ReplayResult>>();

  /**
   * Record a failed job to the dead letter queue when it exceeds retry attempts.
   */
  async recordDeadLetter(entry: DeadLetterEntry): Promise<void> {
    try {
      await this.prisma.indexerDeadLetter.upsert({
        where: { jobId: entry.jobId },
        update: {
          error: entry.error,
          attemptsMade: entry.attemptsMade,
          recoveredAt: null,
        },
        create: {
          jobId: entry.jobId,
          queueName: entry.queueName,
          eventId: entry.eventId,
          data: JSON.stringify(entry.data),
          error: entry.error,
          attemptsMade: entry.attemptsMade,
        },
      });
      this.logger.warn(
        `[DLQ] Recorded failed job: ${entry.jobId} (queue=${entry.queueName}, eventId=${entry.eventId})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to record dead letter entry: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get all dead letter entries for inspection
   */
  async getDeadLetters(
    queueName?: string,
    limit: number = 100,
  ): Promise<DeadLetterEntry[]> {
    try {
      const entries = await this.prisma.indexerDeadLetter.findMany({
        where: queueName ? { queueName } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return entries.map((entry) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(entry.data) as Record<string, unknown>;
        } catch {
          this.logger.warn(`Invalid DLQ payload for job ${entry.jobId}`);
        }
        return {
          jobId: entry.jobId,
          queueName: entry.queueName,
          eventId: entry.eventId,
          data,
          error: entry.error,
          attemptsMade: entry.attemptsMade,
        };
      });
    } catch (err) {
      this.logger.error(
        `Failed to retrieve dead letters: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Clear a dead letter entry (after recovery or manual intervention)
   */
  async clearDeadLetter(jobId: string): Promise<void> {
    try {
      await this.prisma.indexerDeadLetter.update({
        where: { jobId },
        data: { recoveredAt: new Date() },
      });
      this.logger.log(`[DLQ] Cleared dead letter entry: ${jobId}`);
    } catch (err) {
      this.logger.error(
        `Failed to clear dead letter: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get count of unrecovered dead letters
   */
  async getDeadLetterCount(): Promise<number> {
    try {
      return await this.prisma.indexerDeadLetter.count({
        where: { recoveredAt: null },
      });
    } catch (err) {
      this.logger.error(
        `Failed to count dead letters: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Replay a single dead-lettered job. Idempotent per idempotency key and
   * fail-closed: any dependency (DB/queue) outage aborts the write and returns
   * a typed error rather than silently dropping the replay.
   */
  async replayDeadLetter(
    request: ReplayRequest,
    dispatch: ReplayDispatcher,
  ): Promise<ReplayResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const idempotencyKey = request.idempotencyKey ?? request.jobId;

    const existing = this.inFlightReplays.get(idempotencyKey);
    if (existing) {
      this.logger.log(
        `[DLQ] Deduplicated replay jobId=${request.jobId} correlationId=${correlationId}`,
      );
      const prior = await existing;
      return { ...prior, correlationId, deduplicated: true };
    }

    const run = this.executeReplay(request, dispatch, correlationId);
    this.inFlightReplays.set(idempotencyKey, run);
    try {
      return await run;
    } finally {
      this.inFlightReplays.delete(idempotencyKey);
    }
  }

  private async executeReplay(
    request: ReplayRequest,
    dispatch: ReplayDispatcher,
    correlationId: string,
  ): Promise<ReplayResult> {
    let entry: DeadLetterEntry | undefined;
    try {
      const record = await this.prisma.indexerDeadLetter.findUnique({
        where: { jobId: request.jobId },
      });
      if (!record) {
        return this.fail(request.jobId, correlationId, 'DLQ_NOT_FOUND');
      }
      if (record.recoveredAt) {
        return this.fail(
          request.jobId,
          correlationId,
          'DLQ_ALREADY_RECOVERED',
        );
      }
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(record.data) as Record<string, unknown>;
      } catch {
        this.logger.warn(
          `[DLQ] Invalid payload for job ${record.jobId} correlationId=${correlationId}`,
        );
      }
      entry = {
        jobId: record.jobId,
        queueName: record.queueName,
        eventId: record.eventId,
        data,
        error: record.error,
        attemptsMade: record.attemptsMade,
      };
    } catch (err) {
      this.logger.error(
        `[DLQ] Replay lookup failed jobId=${request.jobId} correlationId=${correlationId}: ${(err as Error).message}`,
      );
      return this.fail(
        request.jobId,
        correlationId,
        'DLQ_DEPENDENCY_UNAVAILABLE',
      );
    }

    try {
      await dispatch(entry, correlationId);
    } catch (err) {
      this.logger.error(
        `[DLQ] Replay dispatch failed jobId=${request.jobId} correlationId=${correlationId}: ${(err as Error).message}`,
      );
      return this.fail(
        request.jobId,
        correlationId,
        'DLQ_DEPENDENCY_UNAVAILABLE',
      );
    }

    try {
      await this.prisma.indexerDeadLetter.update({
        where: { jobId: request.jobId },
        data: { recoveredAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `[DLQ] Replay mark-recovered failed jobId=${request.jobId} correlationId=${correlationId}: ${(err as Error).message}`,
      );
      return this.fail(
        request.jobId,
        correlationId,
        'DLQ_DEPENDENCY_UNAVAILABLE',
      );
    }

    this.logger.log(
      `[DLQ] Replayed jobId=${request.jobId} queue=${entry.queueName} correlationId=${correlationId}`,
    );
    return {
      ok: true,
      jobId: request.jobId,
      correlationId,
      deduplicated: false,
    };
  }

  private fail(
    jobId: string,
    correlationId: string,
    errorCode: ReplayErrorCode,
  ): ReplayResult {
    return {
      ok: false,
      jobId,
      correlationId,
      deduplicated: false,
      errorCode,
      message: errorCode,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
