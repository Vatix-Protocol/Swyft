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

/**
 * Stable error codes for admin analytics entrypoints. Callers (and the
 * InternalKeyGuard-protected controller) can rely on these codes instead of
 * parsing free-form messages.
 */
export const ANALYTICS_ERROR_CODES = {
  DEPENDENCY_UNAVAILABLE: 'ANALYTICS_DEPENDENCY_UNAVAILABLE',
  COMPUTATION_FAILED: 'ANALYTICS_COMPUTATION_FAILED',
  INVALID_INPUT: 'ANALYTICS_INVALID_INPUT',
} as const;

export type AnalyticsErrorCode =
  (typeof ANALYTICS_ERROR_CODES)[keyof typeof ANALYTICS_ERROR_CODES];

/**
 * Error thrown when an analytics dependency (DB/Redis) is unavailable. This is
 * fail-closed: callers must not receive stale or partial analytics as if they
 * were authoritative.
 */
export class AnalyticsError extends Error {
  constructor(
    readonly code: AnalyticsErrorCode,
    message: string,
    readonly correlationId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

/**
 * Fee APR calculation result. Mirrors the invariants documented in
 * docs/FEE_APR_CALCULATION.md:
 *
 *   feeApr = (feesCollected / tvl) * (SECONDS_PER_YEAR / windowSeconds)
 *
 * - `feesCollected` and `tvl` are non-negative; a zero/absent TVL yields a
 *   zero APR rather than Infinity/NaN (fail-closed, never a bogus rate).
 * - `windowSeconds` must be a positive integer; anything else is rejected with
 *   ANALYTICS_INVALID_INPUT before any DB access.
 * - The result is deterministic for a given (fees, tvl, window) triple so it
 *   can be cached and replayed safely.
 */
export interface FeeAprResult {
  feeApr: number;
  feesCollected: number;
  tvl: number;
  windowSeconds: number;
  correlationId: string;
}

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getOverview(correlationId = this.newCorrelationId()) {
    return this.withCache(
      CACHE_KEYS.OVERVIEW,
      correlationId,
      () => this.computeAndCacheOverview(correlationId),
    );
  }

  async getTvl(interval: TimeInterval, correlationId = this.newCorrelationId()) {
    return this.withCache(
      CACHE_KEYS.TVL(interval),
      correlationId,
      () => this.computeAndCacheTvl(interval, correlationId),
    );
  }

  async getVolume(
    interval: TimeInterval,
    correlationId = this.newCorrelationId(),
  ) {
    return this.withCache(
      CACHE_KEYS.VOLUME(interval),
      correlationId,
      () => this.computeAndCacheVolume(interval, correlationId),
    );
  }

  async getFees(correlationId = this.newCorrelationId()) {
    return this.withCache(
      CACHE_KEYS.FEES,
      correlationId,
      () => this.computeAndCacheFees(correlationId),
    );
  }

  /**
   * Compute the fee APR for a trailing window, matching
   * docs/FEE_APR_CALCULATION.md. This is a pure, deterministic calculation over
   * already-aggregated inputs; it performs no I/O and is safe to call from the
   * admin controller (InternalKeyGuard) or the scheduled recompute job.
   *
   * Fail-closed: invalid windows throw ANALYTICS_INVALID_INPUT before any
   * computation, and a non-positive TVL yields a zero APR instead of a
   * divide-by-zero artifact.
   */
  computeFeeApr(
    feesCollected: number,
    tvl: number,
    windowSeconds: number,
    correlationId = this.newCorrelationId(),
  ): FeeAprResult {
    if (
      !Number.isFinite(windowSeconds) ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds <= 0
    ) {
      throw new AnalyticsError(
        ANALYTICS_ERROR_CODES.INVALID_INPUT,
        'windowSeconds must be a positive integer',
        correlationId,
      );
    }

    const safeFees = Number.isFinite(feesCollected) ? Math.max(0, feesCollected) : 0;
    const safeTvl = Number.isFinite(tvl) ? Math.max(0, tvl) : 0;

    const feeApr =
      safeTvl > 0
        ? (safeFees / safeTvl) * (SECONDS_PER_YEAR / windowSeconds)
        : 0;

    return {
      feeApr,
      feesCollected: safeFees,
      tvl: safeTvl,
      windowSeconds,
      correlationId,
    };
  }

  /** Called by the scheduled BullMQ job every 15 minutes. */
  async recomputeAll(correlationId = this.newCorrelationId()) {
    this.logger.log(
      `Recomputing analytics cache correlationId=${correlationId}`,
    );
    await Promise.all([
      this.computeAndCacheOverview(correlationId),
      ...Object.values(TimeInterval).map((i) =>
        this.computeAndCacheTvl(i, correlationId),
      ),
      ...Object.values(TimeInterval).map((i) =>
        this.computeAndCacheVolume(i, correlationId),
      ),
      this.computeAndCacheFees(correlationId),
    ]);
    this.logger.log(
      `Analytics cache refreshed correlationId=${correlationId}`,
    );
  }

  // ─── Cache / fail-closed helpers ────────────────────────────────────────

  /**
   * Read-through cache wrapper. A cache read failure is treated as a miss so
   * that a Redis outage degrades to a DB read rather than failing the request.
   * A cache write failure is logged but never masks a successful computation.
   */
  private async withCache<T>(
    key: string,
    correlationId: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    try {
      const cached = await this.cache.get(key);
      if (cached) return cached as T;
    } catch (err) {
      this.logger.warn(
        `Analytics cache read failed key=${key} correlationId=${correlationId}: ${this.describe(err)}`,
      );
    }
    return compute();
  }

  /**
   * Persist a computed result. Cache write failures are non-fatal (the value is
   * still returned to the caller) but are surfaced in logs for ops.
   */
  private async writeCache(
    key: string,
    value: unknown,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.cache.set(key, value, CACHE_TTL);
    } catch (err) {
      this.logger.warn(
        `Analytics cache write failed key=${key} correlationId=${correlationId}: ${this.describe(err)}`,
      );
    }
  }

  /**
   * Wrap a DB-backed computation so that any dependency failure is fail-closed:
   * we throw a typed AnalyticsError with a stable code and correlation id
   * instead of returning partial/incorrect analytics.
   */
  private async compute<T>(
    correlationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `Analytics computation failed correlationId=${correlationId}: ${this.describe(err)}`,
      );
      throw new AnalyticsError(
        ANALYTICS_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        'Analytics dependency unavailable',
        correlationId,
        err,
      );
    }
  }

  private newCorrelationId(): string {
    return `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // ─── Computation helpers ────────────────────────────────────────────────

  private async computeAndCacheOverview(correlationId: string) {
    const result = await this.compute(correlationId, async () => {
      const now = new Date();
      const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [swapCount, swaps24h, swaps7d, uniqueWallets, feesRows, tvlRows] =
        await Promise.all([
          this.prisma.swapProcessed.count(),
          this.prisma.swapProcessed.findMany({
            where: { createdAt: { gte: h24 } },
          }),
          this.prisma.swapProcessed.findMany({
            where: { createdAt: { gte: d7 } },
          }),
          this.prisma.swapProcessed.groupBy({ by: ['sender'], _count: true }),
          this.prisma.feesCollected.findMany(),
          this.prisma.positionMinted.findMany(),
        ]);

      const sumAmounts = (rows: { amount0: string; amount1: string }[]) =>
        rows.reduce(
          (acc, r) =>
            acc + Math.abs(Number(r.amount0)) + Math.abs(Number(r.amount1)),
          0,
        );

      return {
        totalTvl: sumAmounts(tvlRows),
        volume24h: sumAmounts(swaps24h),
        volume7d: sumAmounts(swaps7d),
        totalSwapCount: swapCount,
        totalUniqueWallets: uniqueWallets.length,
        totalFeesCollected: sumAmounts(feesRows),
      };
    });

    await this.writeCache(CACHE_KEYS.OVERVIEW, result, correlationId);
    return result;
  }

  private async computeAndCacheTvl(
    interval: TimeInterval,
    correlationId: string,
  ) {
    const result = await this.compute(correlationId, async () => {
      const buckets = this.buildBuckets(interval);
      const since = buckets[0].start;

      const mints = await this.prisma.positionMinted.findMany({
        where: { createdAt: { gte: since } },
      });
      const burns = await this.prisma.positionBurned.findMany({
        where: { createdAt: { gte: since } },
      });

      const series = buckets.map(({ start, end, label }) => {
        const mintedInBucket = mints
          .filter((m) => m.createdAt >= start && m.createdAt < end)
          .reduce((acc, m) => acc + Number(m.amount0) + Number(m.amount1), 0);
        const burnedInBucket = burns
          .filter((b) => b.createdAt >= start && b.createdAt < end)
          .reduce((acc, b) => acc + Number(b.amount0) + Number(b.amount1), 0);
        return { timestamp: label, tvl: mintedInBucket - burnedInBucket };
      });

      return { interval, series };
    });

    await this.writeCache(CACHE_KEYS.TVL(interval), result, correlationId);
    return result;
  }

  private async computeAndCacheVolume(
    interval: TimeInterval,
    correlationId: string,
  ) {
    const result = await this.compute(correlationId, async () => {
      const buckets = this.buildBuckets(interval);
      const since = buckets[0].start;

      const swaps = await this.prisma.swapProcessed.findMany({
        where: { createdAt: { gte: since } },
      });

      const series = buckets.map(({ start, end, label }) => {
        const volume = swaps
          .filter((s) => s.createdAt >= start && s.createdAt < end)
          .reduce(
            (acc, s) =>
              acc + Math.abs(Number(s.amount0)) + Math.abs(Number(s.amount1)),
            0,
          );
        return { timestamp: label, volume };
      });

      return { interval, series };
    });

    await this.writeCache(CACHE_KEYS.VOLUME(interval), result, correlationId);
    return result;
  }

  private async computeAndCacheFees(correlationId: string) {
    const result = await this.compute(correlationId, async () => {
      const fees = await this.prisma.feesCollected.findMany();
      const totalFees = fees.reduce(
        (acc, f) => acc + Math.abs(Number(f.amount0)) + Math.abs(Number(f.amount1)),
        0,
      );
      return { totalFees };
    });

    await this.writeCache(CACHE_KEYS.FEES, result, correlationId);
    return result;
  }

  private buildBuckets(interval: TimeInterval) {
    const now = new Date();
    const buckets: { start: Date; end: Date; label: string }[] = [];
    const stepMs =
      interval === TimeInterval.HOUR
        ? 60 * 60 * 1000
        : interval === TimeInterval.DAY
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
    const count = interval === TimeInterval.HOUR ? 24 : interval === TimeInterval.DAY ? 30 : 12;

    for (let i = count - 1; i >= 0; i--) {
      const end = new Date(now.getTime() - i * stepMs);
      const start = new Date(end.getTime() - stepMs);
      buckets.push({ start, end, label: start.toISOString() });
    }
    return buckets;
  }
}
