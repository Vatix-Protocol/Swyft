import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { AnalyticsService } from './analytics.service';
import { makeQueueOptions } from '../indexer/queues';

const QUEUE_NAME = 'analytics.refresh';
const JOB_NAME = 'recompute';

@Injectable()
export class AnalyticsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsScheduler.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(private readonly analytics: AnalyticsService) {}

  async onModuleInit() {
    const opts = makeQueueOptions();
    this.queue = new Queue(QUEUE_NAME, opts);
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (job.name === JOB_NAME) {
          await this.analytics.recomputeAll();
        }
      },
      { connection: opts.connection },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Analytics job failed jobId=${job?.id} err=${err.message}`, err.stack);
    });

    // Upsert the repeatable job — runs every 15 minutes
    await this.queue.upsertJobScheduler(
      'analytics-refresh-scheduler',
      { every: 15 * 60 * 1000 },
      { name: JOB_NAME, opts: { removeOnComplete: { count: 5 }, removeOnFail: false } },
    );

    this.logger.log('Analytics scheduler started (every 15 min)');
  }

  async onModuleDestroy() {
    await this.worker.close();
    await this.queue.close();
  }
}
