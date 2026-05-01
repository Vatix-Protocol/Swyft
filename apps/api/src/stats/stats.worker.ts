import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { makeQueueOptions } from '../indexer/queues';
import { STATS_QUEUE_NAME, STATS_JOB_NAME } from './stats.queue';

@Injectable()
export class StatsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatsWorker.name);
  private readonly prisma = new PrismaClient();
  private worker: Worker;

  constructor(private readonly cache: CacheService) {}

  onModuleInit() {
    const { connection } = makeQueueOptions();
    this.worker = new Worker(STATS_QUEUE_NAME, (job: Job) => this.process(job), { connection });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`stats job failed jobId=${job?.id} err=${err.message}`),
    );
    this.logger.log('Stats worker started');
  }

  async onModuleDestroy() {
    await this.worker.close();
    await this.prisma.$disconnect();
  }

  private async process(_job: Job): Promise<void> {
    const start = Date.now();
    const pools = await this.prisma.poolCreated.findMany();
    const now = new Date();
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let updated = 0;

    for (const pool of pools) {
      try {
        const [swaps24h, swaps7d, positions] = await Promise.all([
          this.prisma.swapProcessed.findMany({ where: { poolId: pool.poolId, createdAt: { gte: ago24h } } }),
          this.prisma.swapProcessed.findMany({ where: { poolId: pool.poolId, createdAt: { gte: ago7d } } }),
          this.prisma.positionMinted.findMany({ where: { poolId: pool.poolId } }),
        ]);

        const priceA = await this.getUsdPrice(pool.tokenA);
        const priceB = await this.getUsdPrice(pool.tokenB);

        const tvl = positions.reduce((sum, p) => {
          return sum + Number(p.amount0) * priceA + Number(p.amount1) * priceB;
        }, 0);

        const volume24h = swaps24h.reduce(
          (sum, s) => sum + Math.abs(Number(s.amount0)) * priceA + Math.abs(Number(s.amount1)) * priceB,
          0,
        );
        const volume7d = swaps7d.reduce(
          (sum, s) => sum + Math.abs(Number(s.amount0)) * priceA + Math.abs(Number(s.amount1)) * priceB,
          0,
        );

        const feeBps = Number(pool.fee);
        const fees24h = volume24h * (feeBps / 1_000_000);
        const feeApr = tvl > 0 ? (fees24h / tvl) * 365 * 100 : 0;

        await this.prisma.pool.upsert({
          where: { poolId: pool.poolId },
          update: { tvl, volume24h, volume7d, feeApr },
          create: {
            poolId: pool.poolId,
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
            feeTier: pool.fee,
            tvl,
            volume24h,
            volume7d,
            feeApr,
          },
        });

        updated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to compute stats for pool=${pool.poolId}: ${msg}`);
      }
    }

    const elapsed = Date.now() - start;
    this.logger.log(`Pool stats updated pools=${updated} elapsed=${elapsed}ms`);
  }

  private async getUsdPrice(token: string): Promise<number> {
    const cached = await this.cache.get<number>(`price:usd:${token}`);
    return cached ?? 1;
  }
}
