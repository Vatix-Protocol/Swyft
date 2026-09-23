import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface DeadLetterEntry {
  jobId: string;
  queueName: string;
  eventId: string;
  data: Record<string, unknown>;
  error: string;
  attemptsMade: number;
}

@Injectable()
export class IndexerDeadLetterService {
  private readonly logger = new Logger(IndexerDeadLetterService.name);
  private readonly prisma = new PrismaClient();

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
   * Get all dead letter entries for inspection.
   * When `unrecoveredOnly` is true, skips entries that already have `recoveredAt`.
   */
  async getDeadLetters(
    queueName?: string,
    limit: number = 100,
    unrecoveredOnly = false,
  ): Promise<DeadLetterEntry[]> {
    try {
      const entries = await this.prisma.indexerDeadLetter.findMany({
        where: {
          ...(queueName ? { queueName } : {}),
          ...(unrecoveredOnly ? { recoveredAt: null } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return entries.map((entry) => this.toEntry(entry));
    } catch (err) {
      this.logger.error(
        `Failed to retrieve dead letters: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Look up a single dead-letter row by BullMQ job id (recovered or not).
   */
  async getDeadLetter(jobId: string): Promise<DeadLetterEntry | null> {
    try {
      const entry = await this.prisma.indexerDeadLetter.findUnique({
        where: { jobId },
      });
      return entry ? this.toEntry(entry) : null;
    } catch (err) {
      this.logger.error(
        `Failed to retrieve dead letter ${jobId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private toEntry(entry: {
    jobId: string;
    queueName: string;
    eventId: string;
    data: string;
    error: string;
    attemptsMade: number;
  }): DeadLetterEntry {
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

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
