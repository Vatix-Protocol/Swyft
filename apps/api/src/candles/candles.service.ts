import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CandleInterval = '1m' | '5m' | '1h' | '1d';

/**
 * Stable error codes for the candles processor. Callers (and ops dashboards)
 * can branch on these without parsing free-form messages.
 */
export const CandleErrorCode = {
  INVALID_INTERVAL: 'CANDLES_INVALID_INTERVAL',
  UNAUTHORIZED: 'CANDLES_UNAUTHORIZED',
  DEPENDENCY_UNAVAILABLE: 'CANDLES_DEPENDENCY_UNAVAILABLE',
  CONCURRENT_PROCESSING: 'CANDLES_CONCURRENT_PROCESSING',
} as const;
export type CandleErrorCode =
  (typeof CandleErrorCode)[keyof typeof CandleErrorCode];

export class CandleError extends Error {
  constructor(
    readonly code: CandleErrorCode,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = 'CandleError';
  }
}

/**
 * CANDLE_GAP_POLICY (see docs/CANDLE_GAP_POLICY.md):
 *  - `strict` (default): a gap in the source series aborts the write so we
 *    never persist a candle that silently bridges missing data.
 *  - `fill`: gaps are tolerated and the missing buckets are skipped.
 * The policy is deny-by-default: only `fill` opts out of fail-closed behavior.
 */
export type CandleGapPolicy = 'strict' | 'fill';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
  /**
   * 1-day candle: covers the UTC-midnight-to-midnight window of the previous
   * calendar day. The BullMQ cron `0 0 * * *` fires at UTC midnight so the
   * period calculation always resolves to yesterday's window.
   */
  '1d': 86_400_000,
};

// 1h candles are derived from already-aggregated 5m buckets instead of
// re-scanning raw swaps, so they stay consistent with the 5m series.
const BUCKET_SOURCE: Partial<Record<CandleInterval, CandleInterval>> = {
  '1h': '5m',
};

interface Ohlcv {
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

/**
 * Minimal authz surface. The processor is a privileged, money-path writer, so
 * callers must present a role that is explicitly allowed. Anything else is
 * denied by default.
 */
export interface CandleActor {
  id: string;
  roles: readonly string[];
}

const ALLOWED_ROLES = ['admin', 'candles:write'] as const;

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);

  /** In-process guard against concurrent/replayed processing of the same key. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async aggregate(
    interval: CandleInterval,
    actor: CandleActor,
    correlationId: string = CandlesService.newCorrelationId(),
    gapPolicy: CandleGapPolicy = 'strict',
  ): Promise<void> {
    this.authorize(actor, correlationId);
    this.assertInterval(interval, correlationId);

    const ms = INTERVAL_MS[interval];
    const periodStart = new Date(Math.floor((Date.now() - ms) / ms) * ms);
    const written = await this.runExclusive(
      `${interval}:${periodStart.toISOString()}`,
      correlationId,
      () => this.aggregatePeriod(interval, periodStart, gapPolicy, correlationId),
    );
    this.logger.log(
      `[${interval}] Wrote ${written} candle(s) for period ${periodStart.toISOString()} correlationId=${correlationId}`,
    );
  }

  /** Fills in every candle of `interval` missing since the first recorded swap. */
  async backfill(
    interval: CandleInterval,
    actor: CandleActor,
    correlationId: string = CandlesService.newCorrelationId(),
    gapPolicy: CandleGapPolicy = 'strict',
  ): Promise<void> {
    this.authorize(actor, correlationId);
    this.assertInterval(interval, correlationId);

    const firstSwap = await this.prisma.swapProcessed.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!firstSwap) return;

    const ms = INTERVAL_MS[interval];
    let periodStart = new Date(
      Math.floor(firstSwap.createdAt.getTime() / ms) * ms,
    );
    const lastPeriodStart = new Date(Math.floor((Date.now() - ms) / ms) * ms);

    let written = 0;
    while (periodStart < lastPeriodStart) {
      written += await this.runExclusive(
        `${interval}:${periodStart.toISOString()}`,
        correlationId,
        () => this.aggregatePeriod(interval, periodStart, gapPolicy, correlationId),
      );
      periodStart = new Date(periodStart.getTime() + ms);
    }
    this.logger.log(
      `[${interval}] Backfilled ${written} candle(s) correlationId=${correlationId}`,
    );
  }

  private async aggregatePeriod(
    interval: CandleInterval,
    periodStart: Date,
    gapPolicy: CandleGapPolicy,
    correlationId: string,
  ): Promise<number> {
    const periodEnd = new Date(periodStart.getTime() + INTERVAL_MS[interval]);
    const sourceInterval = BUCKET_SOURCE[interval];
    const byPool = new Map<string, Ohlcv>();

    if (sourceInterval) {
      const buckets = await this.prisma.priceCandle.findMany({
        where: {
          interval: sourceInterval,
          periodStart: { gte: periodStart, lt: periodEnd },
        },
        orderBy: { periodStart: 'asc' },
      });
      this.assertNoGap(
        buckets.map((b) => b.periodStart.getTime()),
        periodStart.getTime(),
        periodEnd.getTime(),
        INTERVAL_MS[sourceInterval],
        gapPolicy,
        correlationId,
      );
      for (const b of buckets) {
        this.accumulate(byPool, b.poolId, b.open, b.high, b.low, b.close, b.volumeUsd);
      }
    } else {
      const swaps = await this.prisma.swapProcessed.findMany({
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
        orderBy: { createdAt: 'asc' },
      });
      for (const s of swaps) {
        const price = Number(s.sqrtPriceX96);
        const volume = Math.abs(Number(s.amount0));
        this.accumulate(byPool, s.poolId, price, price, price, price, volume);
      }
    }

    for (const [poolId, ohlcv] of byPool) {
      const candle = { poolId, interval, periodStart, ...ohlcv };
      await this.prisma.priceCandle.upsert({
        where: {
          poolId_interval_periodStart: { poolId, interval, periodStart },
        },
        create: candle,
        update: candle,
      });
    }

    return byPool.size;
  }

  /**
   * CANDLE_GAP_POLICY enforcement. In `strict` mode any missing source bucket
   * inside the window aborts the write (fail-closed). In `fill` mode the gap
   * is logged and tolerated.
   */
  private assertNoGap(
    presentStarts: number[],
    windowStart: number,
    windowEnd: number,
    stepMs: number,
    gapPolicy: CandleGapPolicy,
    correlationId: string,
  ): void {
    if (gapPolicy === 'fill') return;
    const present = new Set(presentStarts);
    for (let t = windowStart; t < windowEnd; t += stepMs) {
      if (!present.has(t)) {
        throw new CandleError(
          CandleErrorCode.DEPENDENCY_UNAVAILABLE,
          `Candle gap detected at ${new Date(t).toISOString()}; refusing to write under strict policy`,
          correlationId,
        );
      }
    }
  }

  /** Deny-by-default authz for the privileged candles processor. */
  private authorize(actor: CandleActor | undefined, correlationId: string): void {
    const allowed =
      !!actor && actor.roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r));
    if (!allowed) {
      throw new CandleError(
        CandleErrorCode.UNAUTHORIZED,
        'Caller is not authorized to process candles',
        correlationId,
      );
    }
  }

  private assertInterval(
    interval: CandleInterval,
    correlationId: string,
  ): void {
    if (!Object.prototype.hasOwnProperty.call(INTERVAL_MS, interval)) {
      throw new CandleError(
        CandleErrorCode.INVALID_INTERVAL,
        `Unsupported candle interval: ${String(interval)}`,
        correlationId,
      );
    }
  }

  /**
   * Idempotency/concurrency guard: a replayed or concurrent request for the
   * same interval+period is rejected instead of racing the upsert.
   */
  private async runExclusive<T>(
    key: string,
    correlationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (this.inFlight.has(key)) {
      throw new CandleError(
        CandleErrorCode.CONCURRENT_PROCESSING,
        `Candle processing already in flight for ${key}`,
        correlationId,
      );
    }
    this.inFlight.add(key);
    try {
      return await fn();
    } catch (err) {
      // Fail-closed: surface dependency outages as a stable, typed error.
      if (err instanceof CandleError) throw err;
      this.logger.error(
        `Candle processing failed for ${key} correlationId=${correlationId}: ${(err as Error).message}`,
      );
      throw new CandleError(
        CandleErrorCode.DEPENDENCY_UNAVAILABLE,
        'Candle processing dependency unavailable',
        correlationId,
      );
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Folds one more open/high/low/close/volume sample into the running candle for a pool. */
  private accumulate(
    byPool: Map<string, Ohlcv>,
    poolId: string,
    open: number,
    high: number,
    low: number,
    close: number,
    volumeUsd: number,
  ): void {
    const existing = byPool.get(poolId);
    if (!existing) {
      byPool.set(poolId, { open, high, low, close, volumeUsd });
      return;
    }
    existing.high = Math.max(existing.high, high);
    existing.low = Math.min(existing.low, low);
    existing.close = close;
    existing.volumeUsd += volumeUsd;
  }

  private static newCorrelationId(): string {
    return `candles-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
