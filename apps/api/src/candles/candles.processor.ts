import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { CandlesService, CandleInterval } from './candles.service';

export const CANDLES_QUEUE = 'candle-aggregation';
const REDIS_CONNECTION = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const SCHEDULES: { interval: CandleInterval; cron: string }[] = [
  { interval: '1m', cron: '* * * * *' },
  { interval: '5m', cron: '*/5 * * * *' },
  { interval: '1h', cron: '0 * * * *' },
  { interval: '1d', cron: '0 0 * * *' },
];

@Injectable()
export class CandlesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandlesWorker.name);
  private worker!: Worker<{ interval: CandleInterval }>;
  private readonly queue = new Queue<{ interval: CandleInterval }>(CANDLES_QUEUE, {
    connection: REDIS_CONNECTION,
  });

  constructor(private readonly service: CandlesService) {}

  async onModuleInit() {
    this.worker = new Worker<{ interval: CandleInterval }>(
      CANDLES_QUEUE,
      (job: Job<{ interval: CandleInterval }>) => this.service.aggregate(job.data.interval),
      { connection: REDIS_CONNECTION },
    );
    this.worker.on('completed', (job) => {
      this.logger.log(`candle job completed interval=${job.data.interval}`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`candle job failed interval=${job?.data.interval} err=${err.message}`);
    });

    // Clear stale repeatable jobs and re-register
    const existing = await this.queue.getRepeatableJobs();
    await Promise.all(existing.map((j) => this.queue.removeRepeatableByKey(j.key)));

    for (const { interval, cron } of SCHEDULES) {
      await this.queue.add(
        interval,
        { interval },
        { repeat: { pattern: cron }, jobId: `candle-${interval}` },
      );
    }

    this.logger.log('Candle aggregation worker started');
  }

  async onModuleDestroy() {
    await this.worker.close();
    await this.queue.close();
  }
}
