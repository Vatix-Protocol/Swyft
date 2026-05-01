import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { STATS_JOB_NAME } from './stats.queue';
import { defaultJobOptions } from '../indexer/queues';

export const STATS_QUEUE = 'STATS_QUEUE';

@Injectable()
export class StatsScheduler {
  private readonly logger = new Logger(StatsScheduler.name);

  constructor(@Inject(STATS_QUEUE) private readonly queue: Queue) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduleAggregation(): Promise<void> {
    await this.queue.add(STATS_JOB_NAME, {}, {
      ...defaultJobOptions,
      jobId: `pool-stats-${Math.floor(Date.now() / 300_000)}`, // deduplicate within 5-min window
    });
    this.logger.log('Enqueued pool stats aggregation job');
  }
}
