import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CandleInterval = '1m' | '5m' | '1h' | '1d';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
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

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async aggregate(interval: CandleInterval): Promise<void> {
    const ms = INTERVAL_MS[interval];
    const periodStart = new Date(Math.floor((Date.now() - ms) / ms) * ms);
    const written = await this.aggregatePeriod(interval, periodStart);
    this.logger.log(
      `[${interval}] Wrote ${written} candle(s) for period ${periodStart.toISOString()}`,
    );
  }

  /** Fills in every candle of `interval` missing since the first recorded swap. */
  async backfill(interval: CandleInterval): Promise<void> {
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
      written += await this.aggregatePeriod(interval, periodStart);
      periodStart = new Date(periodStart.getTime() + ms);
    }
    this.logger.log(`[${interval}] Backfilled ${written} candle(s)`);
  }

  private async aggregatePeriod(
    interval: CandleInterval,
    periodStart: Date,
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
}
