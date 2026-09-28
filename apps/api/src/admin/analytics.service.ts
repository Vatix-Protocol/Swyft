import { Injectable, Logger } from '@nestjs/common';
import { TimeInterval } from './dto/analytics-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { USD_PRICE_CACHE_KEY } from '../stats/usd-price-feed.service';
import { calculateSwapVolumeUsd } from '../stats/volume-metrics';

const INTERVAL_MS: Record<TimeInterval, number> = {
  [TimeInterval.ONE_DAY]: 24 * 60 * 60 * 1000,
  [TimeInterval.SEVEN_DAYS]: 7 * 24 * 60 * 60 * 1000,
  [TimeInterval.THIRTY_DAYS]: 30 * 24 * 60 * 60 * 1000,
};

const CACHE_TTL_SECONDS = 5 * 60;

export const ANALYTICS_CACHE_KEYS = {
  overview: 'admin:analytics:v1:overview',
  tvl: (interval: TimeInterval) => `admin:analytics:v1:tvl:${interval}`,
  volume: (interval: TimeInterval) => `admin:analytics:v1:volume:${interval}`,
  fees: 'admin:analytics:v1:fees',
  feeApr: 'admin:analytics:v1:fee-apr',
  snapshot: 'admin:analytics:v1:snapshot',
} as const;

export type AnalyticsErrorCode =
  'ANALYTICS_INVALID_INTERVAL' | 'ANALYTICS_UNAVAILABLE';

export class AnalyticsError extends Error {
  constructor(
    readonly code: AnalyticsErrorCode,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getOverview() {
    const correlationId = this.newCorrelationId();
    try {
      const [pools, activePositions, totalSwaps] = await Promise.all([
        this.prisma.pool.findMany({
          select: { tvl: true, volume24h: true },
        }),
        this.prisma.position.count({ where: { closedAt: null } }),
        this.prisma.swap.count(),
      ]);
      const totalTvl = pools.reduce(
        (sum, pool) => sum + this.readNonNegative(pool.tvl),
        0,
      );
      const totalVolume24h = pools.reduce(
        (sum, pool) => sum + this.readNonNegative(pool.volume24h),
        0,
      );
      return {
        totalTvl: String(totalTvl),
        totalVolume24h: String(totalVolume24h),
        poolCount: pools.length,
        activePositions,
        totalSwaps,
      };
    } catch (error) {
      throw this.unavailable('overview', correlationId, error);
    }
  }

  async getTvl(interval: TimeInterval) {
    const { start, end } = this.resolveWindow(interval);
    const correlationId = this.newCorrelationId();
    try {
      const snapshots = await this.prisma.tvlSnapshot.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: [{ date: 'asc' }, { poolId: 'asc' }],
        select: { date: true, tvlUsd: true },
      });
      const byDay = new Map<string, number>();
      for (const snapshot of snapshots) {
        const day = snapshot.date.toISOString().slice(0, 10);
        byDay.set(
          day,
          (byDay.get(day) ?? 0) + this.readNonNegative(snapshot.tvlUsd),
        );
      }
      return {
        interval,
        from: start.toISOString(),
        to: end.toISOString(),
        series: [...byDay].map(([date, value]) => ({ date, value })),
      };
    } catch (error) {
      throw this.unavailable('tvl', correlationId, error);
    }
  }

  async getVolume(interval: TimeInterval) {
    const { start, end } = this.resolveWindow(interval);
    const correlationId = this.newCorrelationId();
    try {
      const tokenByAddress = new Map<
        string,
        { address: string; decimals: number }
      >();
      const prices = new Map<string, number>();
      const byDay = new Map<string, number>();
      const pageSize = 1000;
      let cursorId: string | undefined;

      while (true) {
        const swaps = await this.prisma.swap.findMany({
          where: { timestamp: { gte: start, lt: end } },
          orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            amount0: true,
            amount1: true,
            timestamp: true,
            pool: {
              select: {
                token0Address: true,
                token1Address: true,
              },
            },
          },
          take: pageSize,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        });
        const addresses = [
          ...new Set(
            swaps.flatMap((swap) => [
              swap.pool.token0Address,
              swap.pool.token1Address,
            ]),
          ),
        ];
        const missingAddresses = addresses.filter(
          (address) => !tokenByAddress.has(address),
        );
        if (missingAddresses.length > 0) {
          const tokens = await this.prisma.token.findMany({
            where: { address: { in: missingAddresses } },
            select: { address: true, decimals: true },
          });
          for (const token of tokens) tokenByAddress.set(token.address, token);
          for (const address of missingAddresses) {
            if (!tokenByAddress.has(address)) {
              throw new Error('Swap pool token metadata is unavailable');
            }
          }
          await Promise.all(
            missingAddresses.map(async (address) => {
              const price = await this.cache.get<number>(
                USD_PRICE_CACHE_KEY(address),
              );
              if (price === null || !Number.isFinite(price) || price <= 0) {
                throw new Error(`USD price unavailable for token=${address}`);
              }
              prices.set(address, price);
            }),
          );
        }

        for (const swap of swaps) {
          const token0 = tokenByAddress.get(swap.pool.token0Address);
          const token1 = tokenByAddress.get(swap.pool.token1Address);
          const price0 = prices.get(swap.pool.token0Address);
          const price1 = prices.get(swap.pool.token1Address);
          if (
            !token0 ||
            !token1 ||
            price0 === undefined ||
            price1 === undefined
          ) {
            throw new Error('Swap pool token metadata or price is unavailable');
          }
          const volume = calculateSwapVolumeUsd(
            swap,
            token0.decimals,
            token1.decimals,
            price0,
            price1,
          );
          const day = swap.timestamp.toISOString().slice(0, 10);
          const dailyVolume = (byDay.get(day) ?? 0) + volume;
          if (!Number.isFinite(dailyVolume)) {
            throw new Error('Computed daily volume is invalid');
          }
          byDay.set(day, dailyVolume);
        }

        if (swaps.length < pageSize) break;
        const nextCursor = swaps[swaps.length - 1].id;
        if (!nextCursor || nextCursor === cursorId) {
          throw new Error('Swap volume pagination cursor did not advance');
        }
        cursorId = nextCursor;
      }

      return {
        interval,
        from: start.toISOString(),
        to: end.toISOString(),
        series: [...byDay].map(([date, volumeUsd]) => ({ date, volumeUsd })),
      };
    } catch (error) {
      throw this.unavailable('volume', correlationId, error);
    }
  }

  async getFees() {
    const correlationId = this.newCorrelationId();
    try {
      const records = await this.prisma.feesCollected.findMany({
        orderBy: [{ poolId: 'asc' }, { createdAt: 'asc' }],
        select: { poolId: true, amount0: true, amount1: true },
      });
      const totals = new Map<string, { amount0: bigint; amount1: bigint }>();
      for (const record of records) {
        const total = totals.get(record.poolId) ?? { amount0: 0n, amount1: 0n };
        total.amount0 += this.readInteger(record.amount0);
        total.amount1 += this.readInteger(record.amount1);
        totals.set(record.poolId, total);
      }
      return {
        byPool: [...totals].map(([poolId, amounts]) => ({
          poolId,
          feesAmount0: amounts.amount0.toString(),
          feesAmount1: amounts.amount1.toString(),
        })),
      };
    } catch (error) {
      throw this.unavailable('fees', correlationId, error);
    }
  }

  async getFeeApr(poolId?: string) {
    const correlationId = this.newCorrelationId();
    try {
      const pools = await this.prisma.pool.findMany({
        ...(poolId ? { where: { id: poolId } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, feeApr: true },
      });
      return {
        byPool: pools.map((pool) => ({
          poolId: pool.id,
          feeApr: String(this.readNonNegative(pool.feeApr)),
        })),
      };
    } catch (error) {
      throw this.unavailable('fee_apr', correlationId, error);
    }
  }

  async recomputeAll(correlationId = this.newCorrelationId()): Promise<void> {
    try {
      const [overview, tvl, volume, fees, feeApr] = await Promise.all([
        this.getOverview(),
        this.getTvl(TimeInterval.THIRTY_DAYS),
        this.getVolume(TimeInterval.ONE_DAY),
        this.getFees(),
        this.getFeeApr(),
      ]);
      await this.cache.set(
        ANALYTICS_CACHE_KEYS.snapshot,
        { overview, tvl, volume, fees, feeApr },
        CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(
        `analytics.recompute.failed correlationId=${correlationId} err=${error instanceof Error ? error.name : 'Error'}`,
      );
      throw error;
    }
  }

  private resolveWindow(interval: TimeInterval): { start: Date; end: Date } {
    const duration = INTERVAL_MS[interval];
    if (!duration) {
      throw new AnalyticsError(
        'ANALYTICS_INVALID_INTERVAL',
        'Unsupported analytics interval',
        this.newCorrelationId(),
      );
    }
    const end = new Date();
    return { start: new Date(end.getTime() - duration), end };
  }

  private readNonNegative(value: string | number): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error('Stored analytics value is invalid');
    }
    return number;
  }

  private readInteger(value: string): bigint {
    if (!/^-?\d+$/.test(value)) {
      throw new Error('Stored fee amount is invalid');
    }
    return BigInt(value);
  }

  private unavailable(
    operation: string,
    correlationId: string,
    error: unknown,
  ): AnalyticsError {
    this.logger.error(
      `analytics.${operation}.failed correlationId=${correlationId} err=${error instanceof Error ? error.name : 'Error'}`,
    );
    return new AnalyticsError(
      'ANALYTICS_UNAVAILABLE',
      `Analytics ${operation} is unavailable`,
      correlationId,
    );
  }

  private newCorrelationId(): string {
    return `analytics-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
