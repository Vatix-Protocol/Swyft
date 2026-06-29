import { CandlesService } from './candles.service';
import { PrismaService } from '../prisma/prisma.service';

function makeSwap(poolId: string, createdAt: Date, sqrtPriceX96: string, amount0: string) {
  return { poolId, createdAt, sqrtPriceX96, amount0 } as never;
}

function makeBucket(
  poolId: string,
  periodStart: Date,
  open: number,
  high: number,
  low: number,
  close: number,
  volumeUsd: number,
) {
  return { poolId, periodStart, open, high, low, close, volumeUsd } as never;
}

describe('CandlesService', () => {
  let prisma: {
    swapProcessed: { findMany: jest.Mock; findFirst: jest.Mock };
    priceCandle: { findMany: jest.Mock; upsert: jest.Mock };
  };
  let service: CandlesService;

  beforeEach(() => {
    prisma = {
      swapProcessed: { findMany: jest.fn(), findFirst: jest.fn() },
      priceCandle: { findMany: jest.fn(), upsert: jest.fn() },
    };
    service = new CandlesService(prisma as unknown as PrismaService);
  });

  it('aggregates a 5m candle directly from raw swaps', async () => {
    prisma.swapProcessed.findMany.mockResolvedValue([
      makeSwap('pool-1', new Date(0), '100', '-5'),
      makeSwap('pool-1', new Date(1000), '120', '3'),
    ]);

    await service.aggregate('5m');

    expect(prisma.swapProcessed.findMany).toHaveBeenCalled();
    expect(prisma.priceCandle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          poolId: 'pool-1',
          open: 100,
          high: 120,
          low: 100,
          close: 120,
          volumeUsd: 8,
        }),
      }),
    );
  });

  it('aggregates a 1h candle from existing 5m buckets instead of raw swaps', async () => {
    prisma.priceCandle.findMany.mockResolvedValue([
      makeBucket('pool-1', new Date(0), 10, 15, 9, 12, 100),
      makeBucket('pool-1', new Date(300_000), 12, 18, 11, 16, 50),
    ]);

    await service.aggregate('1h');

    expect(prisma.swapProcessed.findMany).not.toHaveBeenCalled();
    expect(prisma.priceCandle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ interval: '5m' }) }),
    );
    expect(prisma.priceCandle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          poolId: 'pool-1',
          open: 10,
          high: 18,
          low: 9,
          close: 16,
          volumeUsd: 150,
        }),
      }),
    );
  });

  it('backfills every missing period since the first recorded swap', async () => {
    prisma.swapProcessed.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 3 * 60_000),
    });
    prisma.swapProcessed.findMany.mockResolvedValue([]);

    await service.backfill('1m');

    // ~3 missing 1-minute periods since the first swap.
    expect(prisma.swapProcessed.findMany.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does nothing when there are no recorded swaps to backfill from', async () => {
    prisma.swapProcessed.findFirst.mockResolvedValue(null);

    await service.backfill('1h');

    expect(prisma.priceCandle.findMany).not.toHaveBeenCalled();
  });
});
