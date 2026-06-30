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
  private readonly queue = new Queue<CandleJobData, void>(CANDLES_QUEUE, {
    connection: REDIS_CONNECTION,
  });

  constructor(private readonly service: CandlesService) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<CandleJobData, void>(
      CANDLES_QUEUE,
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

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
