import { CandlesService } from './candles.service';

// ---------------------------------------------------------------------------
// Minimal PrismaService stub — only the methods exercised by CandlesService.
// ---------------------------------------------------------------------------
function makePrismaStub(swaps: any[] = []) {
  return {
    swapProcessed: {
      findMany: jest.fn().mockResolvedValue(swaps),
    },
    priceCandle: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('CandlesService', () => {
  describe('aggregate()', () => {
    it('does nothing when there are no swaps for the period', async () => {
      const prisma = makePrismaStub([]);
      const service = new CandlesService(prisma);

      await service.aggregate('1d');

      expect(prisma.priceCandle.upsert).not.toHaveBeenCalled();
    });

    it('writes a 1d candle with correct OHLCV for a single pool', async () => {
      const swaps = [
        { poolId: 'pool-1', sqrtPriceX96: '100', amount0: '500', createdAt: new Date() },
        { poolId: 'pool-1', sqrtPriceX96: '120', amount0: '-300', createdAt: new Date() },
        { poolId: 'pool-1', sqrtPriceX96: '90',  amount0: '200', createdAt: new Date() },
      ];
      const prisma = makePrismaStub(swaps);
      const service = new CandlesService(prisma);

      await service.aggregate('1d');

      expect(prisma.priceCandle.upsert).toHaveBeenCalledTimes(1);

      const { create } = prisma.priceCandle.upsert.mock.calls[0][0];
      expect(create.poolId).toBe('pool-1');
      expect(create.interval).toBe('1d');
      expect(create.open).toBe(100);     // first sqrtPriceX96
      expect(create.close).toBe(90);    // last  sqrtPriceX96
      expect(create.high).toBe(120);
      expect(create.low).toBe(90);
      // volumeUsd = sum of |amount0| = 500 + 300 + 200 = 1000
      expect(create.volumeUsd).toBe(1000);
    });

    it('writes separate candles for distinct pools', async () => {
      const swaps = [
        { poolId: 'pool-A', sqrtPriceX96: '200', amount0: '100', createdAt: new Date() },
        { poolId: 'pool-B', sqrtPriceX96: '50',  amount0: '400', createdAt: new Date() },
      ];
      const prisma = makePrismaStub(swaps);
      const service = new CandlesService(prisma);

      await service.aggregate('1d');

      expect(prisma.priceCandle.upsert).toHaveBeenCalledTimes(2);

      const poolIds = prisma.priceCandle.upsert.mock.calls.map(
        (c: any[]) => c[0].create.poolId,
      );
      expect(poolIds).toContain('pool-A');
      expect(poolIds).toContain('pool-B');
    });

    it('queries swaps within the previous 1d window', async () => {
      const prisma = makePrismaStub([]);
      const service = new CandlesService(prisma);
      const before = Date.now();

      await service.aggregate('1d');

      const after = Date.now();
      const { where } = prisma.swapProcessed.findMany.mock.calls[0][0];

      // periodEnd should be at most `now` rounded to the day boundary
      const periodEnd: Date = where.createdAt.lt;
      const periodStart: Date = where.createdAt.gte;

      const windowMs = periodEnd.getTime() - periodStart.getTime();
      expect(windowMs).toBe(86_400_000); // exactly one day

      // The period must lie entirely within [before - 2d, after]
      expect(periodStart.getTime()).toBeGreaterThanOrEqual(before - 2 * 86_400_000);
      expect(periodEnd.getTime()).toBeLessThanOrEqual(after + 1000);
    });

    it('supports all defined intervals without throwing', async () => {
      const intervals: Array<'1m' | '5m' | '1h' | '1d'> = ['1m', '5m', '1h', '1d'];
      for (const interval of intervals) {
        const prisma = makePrismaStub([]);
        const service = new CandlesService(prisma);
        await expect(service.aggregate(interval)).resolves.toBeUndefined();
      }
    });
  });
});
