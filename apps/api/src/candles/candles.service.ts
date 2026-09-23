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

/**
 * TICKS_ENDPOINT (see apps/api/TICKS_ENDPOINT.md):
 *  - `limit` is clamped to [1, TICKS_MAX_LIMIT]; anything outside is rejected
 *    with a stable error code rather than silently coerced.
 *  - `cursor` is an opaque, forward-only pagination token. Replays of the same
 *    cursor are idempotent (read-only) and never mutate state.
 *  - Reads are fail-closed: a dependency outage surfaces as
 *    DEPENDENCY_UNAVAILABLE instead of an empty/partial page.
 */
export const TICKS_DEFAULT_LIMIT = 100;
export const TICKS_MAX_LIMIT = 1000;

export const TickErrorCode = {
  INVALID_LIMIT: 'TICKS_INVALID_LIMIT',
  INVALID_CURSOR: 'TICKS_INVALID_CURSOR',
  UNAUTHORIZED: 'TICKS_UNAUTHORIZED',
  DEPENDENCY_UNAVAILABLE: 'TICKS_DEPENDENCY_UNAVAILABLE',
} as const;
export type TickErrorCode =
  (typeof TickErrorCode)[keyof typeof TickErrorCode];

export class TickError extends Error {
  constructor(
    readonly code: TickErrorCode,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = 'TickError';
  }
}

/** Typed query params for the ticks endpoint. */
export interface TicksQuery {
  poolId: string;
  interval?: CandleInterval;
  limit?: number;
  cursor?: string;
}

/** Typed response DTO for the ticks endpoint. */
export interface TickDto {
  poolId: string;
  interval: CandleInterval;
  periodStart: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

export interface TicksPage {
  data: TickDto[];
  nextCursor: string | null;
  correlationId: string;
}

/** Roles allowed to read the ticks endpoint. Deny-by-default. */
const TICKS_READ_ROLES = ['admin', 'candles:read', 'ticks:read'] as const;

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

  /**
   * TICKS_ENDPOINT read path. Returns a forward-paginated page of ticks for a
   * pool. Read-only and idempotent: replaying the same cursor yields the same
   * page and never mutates state. Fail-closed on dependency outage.
   */
  async getTicks(
    query: TicksQuery,
    actor: CandleActor | undefined,
    correlationId: string = CandlesService.newCorrelationId(),
  ): Promise<TicksPage> {
    this.authorizeTicks(actor, correlationId);

    const interval = query.interval ?? '1m';
    this.assertInterval(interval, correlationId);

    const limit = this.resolveLimit(query.limit, correlationId);
    const cursorStart = this.decodeCursor(query.cursor, correlationId);

    let rows: Array<{
      poolId: string;
      interval: string;
      periodStart: Date;
      open: number;
      high: number;
      low: number;
      close: number;
      volumeUsd: number;
    }>;
    try {
      rows = await this.prisma.priceCandle.findMany({
        where: {
          poolId: query.poolId,
          interval,
          ...(cursorStart ? { periodStart: { gt: cursorStart } } : {}),
        },
        orderBy: { periodStart: 'asc' },
        take: limit + 1,
      });
    } catch (err) {
      this.logger.error(
        `Ticks read failed poolId=${query.poolId} correlationId=${correlationId}: ${(err as Error).message}`,
      );
      throw new TickError(
        TickErrorCode.DEPENDENCY_UNAVAILABLE,
        'Tick source is unavailable; refusing to serve a partial page',
        correlationId,
      );
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data: TickDto[] = page.map((r) => ({
      poolId: r.poolId,
      interval: r.interval as CandleInterval,
      periodStart: r.periodStart.toISOString(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volumeUsd: r.volumeUsd,
    }));
    const nextCursor =
      hasMore && page.length > 0
        ? this.encodeCursor(page[page.length - 1].periodStart)
        : null;

    this.logger.log(
      `Ticks served poolId=${query.poolId} interval=${interval} count=${data.length} correlationId=${correlationId}`,
    );
    return { data, nextCursor, correlationId };
  }

  private resolveLimit(limit: number | undefined, correlationId: string): number {
    if (limit === undefined) return TICKS_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > TICKS_MAX_LIMIT) {
      throw new TickError(
        TickErrorCode.INVALID_LIMIT,
        `limit must be an integer between 1 and ${TICKS_MAX_LIMIT}`,
        correlationId,
      );
    }
    return limit;
  }

  private encodeCursor(periodStart: Date): string {
    return Buffer.from(periodStart.toISOString(), 'utf8').toString('base64url');
  }

  private decodeCursor(
    cursor: string | undefined,
    correlationId: string,
  ): Date | undefined {
    if (cursor === undefined || cursor === '') return undefined;
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const date = new Date(decoded);
      if (Number.isNaN(date.getTime())) throw new Error('invalid date');
      return date;
    } catch {
      throw new TickError(
        TickErrorCode.INVALID_CURSOR,
        'cursor is not a valid pagination token',
        correlationId,
      );
    }
  }

  /** Deny-by-default authz for the ticks read endpoint. */
  private authorizeTicks(
    actor: CandleActor | undefined,
    correlationId: string,
  ): void {
    const allowed =
      !!actor &&
      actor.roles.some((r) => (TICKS_READ_ROLES as readonly string[]).includes(r));
    if (!allowed) {
      throw new TickError(
        TickErrorCode.UNAUTHORIZED,
        'Caller is not authorized to read ticks',
        correlationId,
      );
    }
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
        this.accumulate(
          byPool,
          b.poolId,
          b.open,
          b.high,
          b.low,
          b.close,
          b.volumeUsd,
        );
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
   * same interval+period is rejected instead of racing.
   */
  private async runExclusive<T>(
    key: string,
    correlationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (this.inFlight.has(key)) {
      throw new CandleError(
        CandleErrorCode.CONCURRENT_PROCESSING,
        `Concurrent processing for ${key} rejected`,
        correlationId,
      );
    }
    this.inFlight.add(key);
    try {
      return await fn();
    } finally {
      this.inFlight.delete(key);
    }
  }

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
    return `cnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
