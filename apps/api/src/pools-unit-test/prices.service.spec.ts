import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PricesService } from '../../src/prices/prices.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import {
  createMockPrismaService,
  createMockRedisService,
  mockToken,
  mockOhlcv,
} from '../test-utils/mock-factories';

// Candle interval types supported by the API
type OhlcvInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
const ALL_INTERVALS: OhlcvInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

describe('PricesService', () => {
  let service: PricesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedisService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<PricesService>(PricesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getSpotPrice ─────────────────────────────────────────────────────────

  describe('getSpotPrice()', () => {
    const token0 = mockToken({ symbol: 'USDC', address: '0xUSDC' });
    const token1 = mockToken({
      id: 'tok_eth_1',
      symbol: 'ETH',
      address: '0xETH',
    });

    const spotPayload = {
      token0: token0.address,
      token1: token1.address,
      price: 3_575.42,
      priceInverse: 0.0002797,
      blockNumber: 19_500_000,
      timestamp: new Date('2024-06-01T12:00:00Z'),
    };

    it('returns spot price on cache miss and populates cache', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(token0)
        .mockResolvedValueOnce(token1);
      prisma.price.findFirst.mockResolvedValue(spotPayload);

      const result = await service.getSpotPrice(token0.address, token1.address);

      expect(result).toMatchObject({
        price: expect.any(Number),
        token0: token0.address,
        token1: token1.address,
      });
      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it('returns cached spot price without touching Prisma', async () => {
      redis.get.mockResolvedValue(JSON.stringify(spotPayload));

      const result = await service.getSpotPrice(token0.address, token1.address);

      expect(result).toEqual(spotPayload);
      expect(prisma.price.findFirst).not.toHaveBeenCalled();
      expect(prisma.token.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when token0 is unknown', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique.mockResolvedValue(null);

      await expect(
        service.getSpotPrice('0xUnknownToken', token1.address),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when token1 is unknown', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(token0)
        .mockResolvedValueOnce(null);

      await expect(
        service.getSpotPrice(token0.address, '0xUnknownToken'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no price record exists for the pair', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(token0)
        .mockResolvedValueOnce(token1);
      prisma.price.findFirst.mockResolvedValue(null);

      await expect(
        service.getSpotPrice(token0.address, token1.address),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns price with numeric type, not string', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(token0)
        .mockResolvedValueOnce(token1);
      prisma.price.findFirst.mockResolvedValue(spotPayload);

      const result = await service.getSpotPrice(token0.address, token1.address);

      expect(typeof result.price).toBe('number');
    });

    it('does not cache when token not found', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique.mockResolvedValue(null);

      await expect(
        service.getSpotPrice('0xUnknownToken', token1.address),
      ).rejects.toThrow(NotFoundException);

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('uses a cache key that encodes both token addresses', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(token0)
        .mockResolvedValueOnce(token1);
      prisma.price.findFirst.mockResolvedValue(spotPayload);

      await service.getSpotPrice(token0.address, token1.address);

      const cacheKey: string = (redis.get as jest.Mock).mock.calls[0][0];
      expect(cacheKey).toContain(token0.address.toLowerCase());
      expect(cacheKey).toContain(token1.address.toLowerCase());
    });
  });

  // ─── getOhlcv (candles) ───────────────────────────────────────────────────

  describe('getOhlcv()', () => {
    const token0Addr = '0xUSDC';
    const token1Addr = '0xETH';
    const candles = Array.from({ length: 24 }, (_, i) =>
      mockOhlcv({ id: `ohlcv_${i}`, interval: '1h' }),
    );

    it('returns candle array for a valid token pair and interval', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken({ address: token0Addr }))
        .mockResolvedValueOnce(mockToken({ address: token1Addr }));
      prisma.ohlcv.findMany.mockResolvedValue(candles);

      const result = await service.getOhlcv(token0Addr, token1Addr, '1h');

      expect(result).toHaveLength(24);
      expect(result[0]).toMatchObject({ interval: '1h' });
    });

    it.each(ALL_INTERVALS)(
      'handles interval "%s" without throwing',
      async (interval) => {
        redis.get.mockResolvedValue(null);
        prisma.token.findUnique
          .mockResolvedValueOnce(mockToken({ address: token0Addr }))
          .mockResolvedValueOnce(mockToken({ address: token1Addr }));
        prisma.ohlcv.findMany.mockResolvedValue([mockOhlcv({ interval })]);

        await expect(
          service.getOhlcv(token0Addr, token1Addr, interval),
        ).resolves.not.toThrow();
      },
    );

    it('passes interval filter down to Prisma query', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken({ address: token0Addr }))
        .mockResolvedValueOnce(mockToken({ address: token1Addr }));
      prisma.ohlcv.findMany.mockResolvedValue(candles);

      await service.getOhlcv(token0Addr, token1Addr, '4h');

      expect(prisma.ohlcv.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ interval: '4h' }),
        }),
      );
    });

    it('orders candles by timestamp ascending', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken({ address: token0Addr }))
        .mockResolvedValueOnce(mockToken({ address: token1Addr }));
      prisma.ohlcv.findMany.mockResolvedValue(candles);

      await service.getOhlcv(token0Addr, token1Addr, '1d');

      expect(prisma.ohlcv.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.objectContaining({ timestamp: 'asc' }),
        }),
      );
    });

    it('returns cached candles without hitting Prisma', async () => {
      redis.get.mockResolvedValue(JSON.stringify(candles));

      const result = await service.getOhlcv(token0Addr, token1Addr, '1h');

      expect(result).toEqual(candles);
      expect(prisma.ohlcv.findMany).not.toHaveBeenCalled();
    });

    it('stores candles in cache after a DB miss', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken({ address: token0Addr }))
        .mockResolvedValueOnce(mockToken({ address: token1Addr }));
      prisma.ohlcv.findMany.mockResolvedValue(candles);

      await service.getOhlcv(token0Addr, token1Addr, '1h');

      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for unknown token pair', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique.mockResolvedValue(null);

      await expect(
        service.getOhlcv('0xUnknown1', '0xUnknown2', '1h'),
      ).rejects.toThrow(NotFoundException);
    });

    it('respects limit / from / to query parameters', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken({ address: token0Addr }))
        .mockResolvedValueOnce(mockToken({ address: token1Addr }));
      prisma.ohlcv.findMany.mockResolvedValue(candles.slice(0, 5));

      const from = new Date('2024-05-01T00:00:00Z');
      const to = new Date('2024-06-01T00:00:00Z');
      await service.getOhlcv(token0Addr, token1Addr, '1h', { from, to, limit: 5 });

      expect(prisma.ohlcv.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: expect.objectContaining({ gte: from, lte: to }),
          }),
          take: 5,
        }),
      );
    });

    it('returns empty array when no candles exist for pair', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken({ address: token0Addr }))
        .mockResolvedValueOnce(mockToken({ address: token1Addr }));
      prisma.ohlcv.findMany.mockResolvedValue([]);

      const result = await service.getOhlcv(token0Addr, token1Addr, '1w');

      expect(result).toEqual([]);
    });
  });

  // ─── Error propagation ────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('re-throws DB errors from getSpotPrice', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique.mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.getSpotPrice('0xUSDC', '0xETH'),
      ).rejects.toThrow('Connection refused');
    });

    it('re-throws DB errors from getOhlcv', async () => {
      redis.get.mockResolvedValue(null);
      prisma.token.findUnique
        .mockResolvedValueOnce(mockToken())
        .mockResolvedValueOnce(mockToken({ id: 'tok_eth_1' }));
      prisma.ohlcv.findMany.mockRejectedValue(new Error('Query timeout'));

      await expect(
        service.getOhlcv('0xUSDC', '0xETH', '1h'),
      ).rejects.toThrow('Query timeout');
    });
  });
});
