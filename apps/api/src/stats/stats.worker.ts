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
        const [swaps24h, swaps7d] = await Promise.all([
          this.prisma.swap.findMany({
            where: { poolId: pool.id, timestamp: { gte: ago24h } },
          }),
          this.prisma.swap.findMany({
            where: { poolId: pool.id, timestamp: { gte: ago7d } },
          }),
        ]);

        const priceA = await this.getUsdPrice(pool.token0Address);
        const priceB = await this.getUsdPrice(pool.token1Address);

        const tvl = await this.computeTvl(pool, priceA, priceB);

        const volume24h = swaps24h.reduce(
          (sum: number, s: Swap) =>
            sum +
            Math.abs(Number(s.amount0)) * priceA +
            Math.abs(Number(s.amount1)) * priceB,
          0,
        );
        const volume7d = swaps7d.reduce(
          (sum: number, s: Swap) =>
            sum +
            Math.abs(Number(s.amount0)) * priceA +
            Math.abs(Number(s.amount1)) * priceB,
          0,
        );

        const fees24h = swaps24h.reduce(
          (sum: number, s: Swap) => sum + Number(s.feeAmount) * priceA,
          0,
        );
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
    return cached ?? 1;
  }

  /**
   * Values the pool from its actual on-chain reserves at the current tick,
   * derived from the concentrated-liquidity virtual-reserve formulas
   * (reserve0 = L / sqrtPrice, reserve1 = L * sqrtPrice), rather than from
   * liquidity times an average token price.
   */
  private async computeTvl(
    pool: {
      liquidity: string;
      currentSqrtPrice: string;
      token0Address: string;
      token1Address: string;
    },
    priceA: number,
    priceB: number,
  ): Promise<number> {
    const sqrtPrice = Number(pool.currentSqrtPrice) / 2 ** 96;
    if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0) return 0;

    const liquidity = Number(pool.liquidity);
    const [decimals0, decimals1] = await Promise.all([
      this.getTokenDecimals(pool.token0Address),
      this.getTokenDecimals(pool.token1Address),
    ]);

    const reserve0 = liquidity / sqrtPrice / 10 ** decimals0;
    const reserve1 = (liquidity * sqrtPrice) / 10 ** decimals1;

    return reserve0 * priceA + reserve1 * priceB;
  }

  private async getTokenDecimals(address: string): Promise<number> {
    const token = await this.prisma.token.findUnique({ where: { address } });
    return token?.decimals ?? 18;
  }
}
