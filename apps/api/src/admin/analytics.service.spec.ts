import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeInterval } from './dto/analytics-query.dto';
import { AnalyticsError, AnalyticsService } from './analytics.service';
import { USD_PRICE_CACHE_KEY } from '../stats/usd-price-feed.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    pool: { findMany: jest.Mock };
    position: { count: jest.Mock };
    swap: { count: jest.Mock; findMany: jest.Mock };
    token: { findMany: jest.Mock };
    tvlSnapshot: { findMany: jest.Mock };
    feesCollected: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    prisma = {
      pool: {
        findMany: jest.fn().mockResolvedValue([
          { tvl: '100.5', volume24h: '25' },
          { tvl: '10', volume24h: '5' },
        ]),
      },
      position: { count: jest.fn().mockResolvedValue(3) },
      swap: {
        count: jest.fn().mockResolvedValue(8),
        findMany: jest.fn().mockResolvedValue([
          {
            amount0: '-1000000',
            amount1: '500000',
            timestamp: new Date(),
            pool: { token0Address: 'TOKEN0', token1Address: 'TOKEN1' },
          },
        ]),
      },
      token: {
        findMany: jest.fn().mockResolvedValue([
          { address: 'TOKEN0', decimals: 6 },
          { address: 'TOKEN1', decimals: 6 },
        ]),
      },
      tvlSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { date: new Date('2026-09-27T01:00:00Z'), tvlUsd: 25 },
          { date: new Date('2026-09-27T23:00:00Z'), tvlUsd: 10 },
        ]),
      },
      feesCollected: {
        findMany: jest.fn().mockResolvedValue([
          { poolId: 'pool-1', amount0: '10', amount1: '20' },
          { poolId: 'pool-1', amount0: '2', amount1: '3' },
        ]),
      },
    };
    cache = {
      get: jest
        .fn()
        .mockImplementation(async (key: string) =>
          key === USD_PRICE_CACHE_KEY('TOKEN0') ? 2 : 4,
        ),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new AnalyticsService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    );
  });

  it('returns protocol overview totals from persisted projections', async () => {
    await expect(service.getOverview()).resolves.toEqual({
      totalTvl: '110.5',
      totalVolume24h: '30',
      poolCount: 2,
      activePositions: 3,
      totalSwaps: 8,
    });
  });

  it.each([
    [TimeInterval.ONE_DAY, 24 * 60 * 60 * 1000],
    [TimeInterval.SEVEN_DAYS, 7 * 24 * 60 * 60 * 1000],
    [TimeInterval.THIRTY_DAYS, 30 * 24 * 60 * 60 * 1000],
  ])(
    'queries volume in a bounded half-open %s window',
    async (interval, ms) => {
      await service.getVolume(interval);
      const where = prisma.swap.findMany.mock.calls[0][0].where.timestamp;
      expect(where.gte).toBeInstanceOf(Date);
      expect(where.lt).toBeInstanceOf(Date);
      expect(where.lt.getTime() - where.gte.getTime()).toBe(ms);
    },
  );

  it('normalizes swap base units, applies token prices, and groups by UTC day', async () => {
    const result = await service.getVolume(TimeInterval.ONE_DAY);
    expect(result.series).toEqual([{ date: expect.any(String), volumeUsd: 4 }]);
  });

  it('paginates large windows with a stable timestamp/id cursor', async () => {
    const record = (id: string) => ({
      id,
      amount0: '-1000000',
      amount1: '500000',
      timestamp: new Date(),
      pool: { token0Address: 'TOKEN0', token1Address: 'TOKEN1' },
    });
    prisma.swap.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, index) => record(`swap-${index}`)),
      )
      .mockResolvedValueOnce([record('swap-1000')]);

    const result = await service.getVolume(TimeInterval.ONE_DAY);

    expect(prisma.swap.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.swap.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'swap-999' },
      skip: 1,
      take: 1000,
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
    expect(result.series[0].volumeUsd).toBe(4004);
  });

  it('fails closed with a stable code when token price data is missing', async () => {
    cache.get.mockResolvedValue(null);
    await expect(service.getVolume(TimeInterval.ONE_DAY)).rejects.toMatchObject(
      {
        code: 'ANALYTICS_UNAVAILABLE',
        correlationId: expect.any(String),
      } satisfies Partial<AnalyticsError>,
    );
  });

  it('groups historical TVL snapshots into daily totals inside the selected window', async () => {
    const result = await service.getTvl(TimeInterval.SEVEN_DAYS);
    expect(result.series).toEqual([{ date: '2026-09-27', value: 35 }]);
    const where = prisma.tvlSnapshot.findMany.mock.calls[0][0].where.date;
    expect(where.lt.getTime() - where.gte.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it('sums indexed fee amounts exactly with bigint arithmetic', async () => {
    await expect(service.getFees()).resolves.toEqual({
      byPool: [{ poolId: 'pool-1', feesAmount0: '12', feesAmount1: '23' }],
    });
  });
});
