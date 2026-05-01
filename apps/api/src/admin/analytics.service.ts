import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { TimeInterval } from './dto/analytics-query.dto';

const CACHE_TTL = 900; // 15 minutes

const CACHE_KEYS = {
  OVERVIEW: 'analytics:overview',
  TVL: (interval: string) => `analytics:tvl:${interval}`,
  VOLUME: (interval: string) => `analytics:volume:${interval}`,
  FEES: 'analytics:fees',
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getOverview() {
    const cached = await this.cache.get(CACHE_KEYS.OVERVIEW);
    if (cached) return cached;
    return this.computeAndCacheOverview();
  }

  async getTvl(interval: TimeInterval) {
    const cached = await this.cache.get(CACHE_KEYS.TVL(interval));
    if (cached) return cached;
    return this.computeAndCacheTvl(interval);
  }

  async getVolume(interval: TimeInterval) {
    const cached = await this.cache.get(CACHE_KEYS.VOLUME(interval));
    if (cached) return cached;
    return this.computeAndCacheVolume(interval);
  }

  async getFees() {
    const cached = await this.cache.get(CACHE_KEYS.FEES);
    if (cached) return cached;
    return this.computeAndCacheFees();
  }

  /** Called by the scheduled BullMQ job every 15 minutes. */
  async recomputeAll() {
    this.logger.log('Recomputing analytics cache');
    await Promise.all([
      this.computeAndCacheOverview(),
      ...Object.values(TimeInterval).map((i) => this.computeAndCacheTvl(i)),
      ...Object.values(TimeInterval).map((i) => this.computeAndCacheVolume(i)),
      this.computeAndCacheFees(),
    ]);
    this.logger.log('Analytics cache refreshed');
  }

  // ─── Computation helpers ────────────────────────────────────────────────

  private async computeAndCacheOverview() {
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [swapCount, swaps24h, swaps7d, uniqueWallets, feesRows, tvlRows] = await Promise.all([
      this.prisma.swapProcessed.count(),
      this.prisma.swapProcessed.findMany({ where: { createdAt: { gte: h24 } } }),
      this.prisma.swapProcessed.findMany({ where: { createdAt: { gte: d7 } } }),
      this.prisma.swapProcessed.groupBy({ by: ['sender'], _count: true }),
      this.prisma.feesCollected.findMany(),
      this.prisma.positionMinted.findMany(),
    ]);

    const sumAmounts = (rows: { amount0: string; amount1: string }[]) =>
      rows.reduce((acc, r) => acc + Math.abs(Number(r.amount0)) + Math.abs(Number(r.amount1)), 0);

    const result = {
      totalTvl: sumAmounts(tvlRows),
      volume24h: sumAmounts(swaps24h),
      volume7d: sumAmounts(swaps7d),
      totalSwapCount: swapCount,
      totalUniqueWallets: uniqueWallets.length,
      totalFeesCollected: sumAmounts(feesRows),
    };

    await this.cache.set(CACHE_KEYS.OVERVIEW, result, CACHE_TTL);
    return result;
  }

  private async computeAndCacheTvl(interval: TimeInterval) {
    const buckets = this.buildBuckets(interval);
    const since = buckets[0].start;

    const mints = await this.prisma.positionMinted.findMany({ where: { createdAt: { gte: since } } });
    const burns = await this.prisma.positionBurned.findMany({ where: { createdAt: { gte: since } } });

    const series = buckets.map(({ start, end, label }) => {
      const mintedInBucket = mints
        .filter((m) => m.createdAt >= start && m.createdAt < end)
        .reduce((acc, m) => acc + Number(m.amount0) + Number(m.amount1), 0);
      const burnedInBucket = burns
        .filter((b) => b.createdAt >= start && b.createdAt < end)
        .reduce((acc, b) => acc + Number(b.amount0) + Number(b.amount1), 0);
      return { timestamp: label, tvl: mintedInBucket - burnedInBucket };
    });

    const result = { interval, series };
    await this.cache.set(CACHE_KEYS.TVL(interval), result, CACHE_TTL);
    return result;
  }

  private async computeAndCacheVolume(interval: TimeInterval) {
    const buckets = this.buildBuckets(interval);
    const since = buckets[0].start;

    const swaps = await this.prisma.swapProcessed.findMany({ where: { createdAt: { gte: since } } });

    const series = buckets.map(({ start, end, label }) => {
      const volume = swaps
        .filter((s) => s.createdAt >= start && s.createdAt < end)
        .reduce((acc, s) => acc + Math.abs(Number(s.amount0)) + Math.abs(Number(s.amount1)), 0);
      return { timestamp: label, volume };
    });

    const result = { interval, series };
    await this.cache.set(CACHE_KEYS.VOLUME(interval), result, CACHE_TTL);
    return result;
  }

  private async computeAndCacheFees() {
    const rows = await this.prisma.feesCollected.groupBy({
      by: ['poolId'],
      _sum: { amount0: true, amount1: true },
    });

    const byPool = rows.map((r) => ({
      poolId: r.poolId,
      feesAmount0: r._sum.amount0 ?? '0',
      feesAmount1: r._sum.amount1 ?? '0',
    }));

    const result = { byPool };
    await this.cache.set(CACHE_KEYS.FEES, result, CACHE_TTL);
    return result;
  }

  private buildBuckets(interval: TimeInterval) {
    const now = new Date();
    const bucketCount = interval === TimeInterval.ONE_DAY ? 24 : interval === TimeInterval.SEVEN_DAYS ? 7 : 30;
    const bucketMs =
      interval === TimeInterval.ONE_DAY
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

    return Array.from({ length: bucketCount }, (_, i) => {
      const end = new Date(now.getTime() - (bucketCount - 1 - i) * bucketMs);
      const start = new Date(end.getTime() - bucketMs);
      return { start, end, label: start.toISOString() };
    });
  }
}
