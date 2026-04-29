import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CandleInterval = '1m' | '5m' | '1h' | '1d';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
};

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async aggregate(interval: CandleInterval): Promise<void> {
    const ms = INTERVAL_MS[interval];
    const now = Date.now();
    const periodStart = new Date(Math.floor((now - ms) / ms) * ms);
    const periodEnd = new Date(periodStart.getTime() + ms);

    const swaps = await this.prisma.swapProcessed.findMany({
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
      orderBy: { createdAt: 'asc' },
    });

    if (!swaps.length) return;

    const byPool = new Map<string, typeof swaps>();
    for (const swap of swaps) {
      const list = byPool.get(swap.poolId) ?? [];
      list.push(swap);
      byPool.set(swap.poolId, list);
    }

    let written = 0;
    for (const [poolId, poolSwaps] of byPool) {
      const prices = poolSwaps.map((s) => Number(s.sqrtPriceX96));
      const volumeUsd = poolSwaps.reduce((sum, s) => sum + Math.abs(Number(s.amount0)), 0);

      const candle = {
        poolId,
        interval,
        periodStart,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volumeUsd,
      };

      await this.prisma.priceCandle.upsert({
        where: { poolId_interval_periodStart: { poolId, interval, periodStart } },
        create: candle,
        update: candle,
      });
      written++;
    }

    this.logger.log(`[${interval}] Wrote ${written} candles for period ${periodStart.toISOString()}`);
  }
}
