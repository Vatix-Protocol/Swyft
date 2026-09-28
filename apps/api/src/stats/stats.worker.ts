import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { Swap } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService, TTL } from '../cache/cache.service';
import { makeQueueOptions } from '../indexer/queues';
import { STATS_QUEUE_NAME } from './stats.queue';
import { TvlAlertService } from './tvl-alert.service';
import { calculatePoolTvl } from './pool-tvl';
import {
  calculateSwapFeesUsd,
  calculateSwapVolumeUsd,
  isInHalfOpenWindow,
} from './volume-metrics';

/** Cache key prefix for per-pool stats written by StatsWorker. */
export const STATS_CACHE_KEY = (poolId: string) => `stats:pool:${poolId}`;

@Injectable()
export class StatsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatsWorker.name);
  private worker!: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly tvlAlertService: TvlAlertService,
  ) {}

  onModuleInit() {
    const { connection } = makeQueueOptions();
    this.worker = new Worker(
      STATS_QUEUE_NAME,
      (job: Job) => this.process(job),
      {
        connection,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`stats job failed jobId=${job?.id} err=${err.message}`),
    );
    this.logger.log('Stats worker started');
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(_job: Job): Promise<void> {
    const start = Date.now();
    const pools = await this.prisma.pool.findMany();
    const now = new Date();
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let updated = 0;

    for (const pool of pools) {
      try {
        const swaps7d = await this.prisma.swap.findMany({
          where: { poolId: pool.id, timestamp: { gte: ago7d, lt: now } },
          orderBy: { timestamp: 'asc' },
        });
        const swapsIn7d = swaps7d.filter((swap) =>
          isInHalfOpenWindow(swap.timestamp, ago7d, now),
        );
        const swaps24h = swapsIn7d.filter((swap) =>
          isInHalfOpenWindow(swap.timestamp, ago24h, now),
        );

        const [priceA, priceB, token0, token1, positions] = await Promise.all([
          this.getUsdPrice(pool.token0Address),
          this.getUsdPrice(pool.token1Address),
          this.prisma.token.findUnique({
            where: { address: pool.token0Address },
          }),
          this.prisma.token.findUnique({
            where: { address: pool.token1Address },
          }),
          this.prisma.position.findMany({
            where: { poolId: pool.id, closedAt: null },
            select: {
              lowerTick: true,
              upperTick: true,
              liquidity: true,
            },
          }),
        ]);
        if (!token0 || !token1) {
          throw new Error('Pool token metadata is unavailable');
        }

        const tvl = calculatePoolTvl({
          currentSqrtPrice: pool.currentSqrtPrice,
          positions,
          price0: priceA,
          price1: priceB,
          decimals0: token0.decimals,
          decimals1: token1.decimals,
        });

        const volume24h = swaps24h.reduce(
          (sum: number, s: Swap) =>
            sum +
            calculateSwapVolumeUsd(
              s,
              token0.decimals,
              token1.decimals,
              priceA,
              priceB,
            ),
          0,
        );
        const volume7d = swapsIn7d.reduce(
          (sum: number, s: Swap) =>
            sum +
            calculateSwapVolumeUsd(
              s,
              token0.decimals,
              token1.decimals,
              priceA,
              priceB,
            ),
          0,
        );

        const fees24h = swaps24h.reduce(
          (sum: number, s: Swap) =>
            sum + calculateSwapFeesUsd(s.feeAmount, token0.decimals, priceA),
          0,
        );
        if (
          !Number.isFinite(volume24h) ||
          !Number.isFinite(volume7d) ||
          !Number.isFinite(fees24h)
        ) {
          throw new Error('Computed volume metrics are invalid');
        }
        const feeApr = tvl > 0 ? (fees24h / tvl) * 365 * 100 : 0;

        await this.prisma.pool.update({
          where: { id: pool.id },
          data: {
            tvl: String(tvl),
            volume24h: String(volume24h),
            feeApr: String(feeApr),
          },
        });

        await this.cache.set(
          STATS_CACHE_KEY(pool.id),
          {
            tvl,
            volume24h,
            volume7d,
            feeApr,
            updatedAt: new Date().toISOString(),
          },
          TTL.STATS,
        );

        // Record TVL snapshot for historical time series
        await this.tvlAlertService.recordTvlSnapshot(pool.id, tvl);

        // Check and trigger TVL alerts
        await this.tvlAlertService.checkAndTriggerAlerts(pool, tvl);

        updated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to compute stats for pool=${pool.id}: ${msg}`,
        );
      }
    }

    const elapsed = Date.now() - start;
    this.logger.log(`Pool stats updated pools=${updated} elapsed=${elapsed}ms`);
  }

  private async getUsdPrice(token: string): Promise<number> {
    const cached = await this.cache.get<number>(`price:usd:${token}`);
    if (cached === null || !Number.isFinite(cached) || cached <= 0) {
      throw new Error(`USD price unavailable for token=${token}`);
    }
    return cached;
  }
}
