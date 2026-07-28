import { NotFoundException } from '@nestjs/common';
import {
  PriceService,
  PriceEvent,
  normalizePair,
  spotPriceCacheKey,
  fillCandleGaps,
  nullCandle,
} from './price.service';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { WebSocket } from 'ws';

function mockClient(
  readyState: number = WebSocket.OPEN,
): WebSocket & { send: jest.Mock } {
  return { readyState, send: jest.fn() } as unknown as WebSocket & {
    send: jest.Mock;
  };
}

function buildMockSubscriber(): jest.Mocked<Redis> {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
      return mockSub;
    }),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    _handlers: handlers,
  } as unknown as jest.Mocked<Redis> & {
    _handlers: Record<string, (...args: unknown[]) => void>;
  };
}

let mockSub: ReturnType<typeof buildMockSubscriber>;

describe('PriceService', () => {
  let service: PriceService;
  let mockCache: jest.Mocked<Pick<CacheService, 'get' | 'set' | 'invalidate'>>;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockSub = buildMockSubscriber();
    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
      createSubscriber: jest.fn().mockReturnValue(mockSub),
    } as unknown as CacheService;
    mockPrisma = {
      pool: { findFirst: jest.fn() },
      priceCandle: { findMany: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    service = new PriceService(mockCache, mockPrisma);
    service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  const event: PriceEvent = {
    poolId: 'pool-1',
    currentPrice: '1.23',
    sqrtPrice: '1.109',
    tick: 100,
    liquidity: '500000',
    timestamp: Date.now(),
  };

  it('broadcasts to subscribed client', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).toHaveBeenCalledWith(
      JSON.stringify({ event: 'price', data: event }),
    );
  });

  it('does not broadcast after unsubscribe', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.unsubscribe(client, 'pool-1');
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).not.toHaveBeenCalled();
  });

  it('cleans up all pools on disconnect', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.subscribe(client, 'pool-2');
    service.removeClient(client);
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).not.toHaveBeenCalled();
  });

  it('supports multiple clients on same pool', () => {
    const c1 = mockClient();
    const c2 = mockClient();
    service.subscribe(c1, 'pool-1');
    service.subscribe(c2, 'pool-1');
    service.broadcastPrice(event);
    expect(c1.send as jest.Mock).toHaveBeenCalledTimes(1);
    expect(c2.send as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('supports one client on multiple pools', () => {
    const client = mockClient();
    service.subscribe(client, 'pool-1');
    service.subscribe(client, 'pool-2');
    service.broadcastPrice(event);
    service.broadcastPrice({ ...event, poolId: 'pool-2' });
    expect(client.send as jest.Mock).toHaveBeenCalledTimes(2);
  });

  it('skips non-OPEN clients', () => {
    const client = mockClient(WebSocket.CLOSED);
    service.subscribe(client, 'pool-1');
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).not.toHaveBeenCalled();
  });

  it('contains send failures from disconnected clients', () => {
    const client = mockClient();
    (client.send as jest.Mock).mockImplementation(() => {
      throw new Error('socket closed');
    });
    service.subscribe(client, 'pool-1');

    expect(() => service.broadcastPrice(event)).not.toThrow();
    service.broadcastPrice(event);
    expect(client.send as jest.Mock).toHaveBeenCalledTimes(1);
  });

  describe('normalizePair', () => {
    it('returns tokens in lexicographic order', () => {
      expect(normalizePair('XLM', 'USDC')).toEqual(['usdc', 'xlm']);
      expect(normalizePair('USDC', 'XLM')).toEqual(['usdc', 'xlm']);
    });

    it('lowercases both tokens', () => {
      expect(normalizePair('ABC', 'DEF')).toEqual(['abc', 'def']);
    });
  });

  describe('spotPriceCacheKey', () => {
    it('produces the same key regardless of token order', () => {
      expect(spotPriceCacheKey('XLM', 'USDC')).toBe(
        spotPriceCacheKey('USDC', 'XLM'),
      );
    });
  });

  describe('getTokenPairPrice', () => {
    it('returns cached response when available', async () => {
      const cached = {
        tokenA: 'usdc',
        tokenB: 'xlm',
        spotPrice: '0.1',
        change24hAbsolute: '0',
        change24hPercent: '0.0000',
        high24h: '0.1',
        low24h: '0.1',
        lastUpdated: new Date().toISOString(),
      };
      mockCache.get.mockResolvedValueOnce(cached);
      const result = await service.getTokenPairPrice('USDC', 'XLM');
      expect(result).toEqual(cached);
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no pool data exists', async () => {
      mockCache.get.mockResolvedValue(null);
      await expect(service.getTokenPairPrice('USDC', 'XLM')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('invalidatePairCache', () => {
    it('calls cache.invalidate with the normalized key', async () => {
      await service.invalidatePairCache('XLM', 'USDC');
      expect(mockCache.invalidate).toHaveBeenCalledWith(
        spotPriceCacheKey('XLM', 'USDC'),
      );
    });
  });

  describe('subscribe/unsubscribe', () => {
    it('subscribes to Redis channel on first client', () => {
      const client = mockClient();
      service.subscribe(client, 'pool-1');
      expect(mockSub.subscribe).toHaveBeenCalledWith('prices:pool-1');
    });

    it('unsubscribes from Redis channel when last client leaves', () => {
      const client = mockClient();
      service.subscribe(client, 'pool-1');
      service.unsubscribe(client, 'pool-1');
      expect(mockSub.unsubscribe).toHaveBeenCalledWith('prices:pool-1');
    });

    it('re-subscribes to active channels on Redis reconnect', () => {
      const c1 = mockClient();
      const c2 = mockClient();
      service.subscribe(c1, 'pool-1');
      service.subscribe(c2, 'pool-2');

      // Simulate Redis 'ready' event (reconnect)
      const sub = mockSub as unknown as {
        _handlers: Record<string, (...args: unknown[]) => void>;
      };
      sub._handlers['ready']?.();

      expect(mockSub.subscribe).toHaveBeenCalledWith(
        expect.stringContaining('prices:pool-'),
        expect.stringContaining('prices:pool-'),
      );
    });
  });

  describe('load test — 1000 concurrent subscribers', () => {
    it('delivers update to 1000 clients within 200ms', () => {
      const clients = Array.from({ length: 1000 }, () => mockClient());
      for (const c of clients) service.subscribe(c, 'pool-load');

      const start = Date.now();
      service.broadcastPrice({ ...event, poolId: 'pool-load' });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
      for (const c of clients) {
        expect(c.send as jest.Mock).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('fillCandleGaps', () => {
    it('inserts null buckets for missing intervals (no carry-forward)', () => {
      const existing = [
        {
          time: 0,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 10,
        },
        {
          time: 7200,
          open: 3,
          high: 4,
          low: 2.5,
          close: 3.5,
          volume: 20,
        },
      ];

      const filled = fillCandleGaps(existing, 3600, 0, 7200, 10);

      expect(filled).toHaveLength(3);
      expect(filled[0]).toEqual(existing[0]);
      expect(filled[1]).toEqual(nullCandle(3600));
      expect(filled[2]).toEqual(existing[1]);
      expect(filled[1].open).toBeNull();
      expect(filled[1].volume).toBeNull();
    });

    it('returns only null buckets when no candles exist in range', () => {
      const filled = fillCandleGaps([], 3600, 0, 3600, 10);
      expect(filled).toEqual([nullCandle(0), nullCandle(3600)]);
    });

    it('respects limit while filling gaps', () => {
      const filled = fillCandleGaps([], 60, 0, 600, 3);
      expect(filled).toHaveLength(3);
      expect(filled.map((c) => c.time)).toEqual([0, 60, 120]);
    });
  });

  describe('getCandles', () => {
    it('throws NotFoundException when no pool is found', async () => {
      mockPrisma.pool.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.getCandles('USDC', 'XLM', '1h', 100, 200, 10),
      ).rejects.toThrow(NotFoundException);
    });

    it('queries price_candle table for found pool', async () => {
      const mockPool = { id: 'pool-1' };
      const mockCandles = [
        {
          id: 'candle-1',
          poolId: 'pool-1',
          interval: '1h',
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volumeUsd: 10000,
          periodStart: new Date(3600_000),
          pool: null,
        },
      ];
      mockPrisma.pool.findFirst.mockResolvedValueOnce(mockPool);
      mockPrisma.priceCandle.findMany.mockResolvedValueOnce(mockCandles);

      const result = await service.getCandles(
        'USDC',
        'XLM',
        '1h',
        3600,
        3600,
        10,
      );

      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].open).toBe(100);
      expect(result.candles[0].high).toBe(105);
      expect(result.candles[0].low).toBe(95);
      expect(result.candles[0].close).toBe(102);
      expect(result.candles[0].volume).toBe(10000);
      expect(mockPrisma.priceCandle.findMany).toHaveBeenCalledWith({
        where: {
          poolId: 'pool-1',
          interval: '1h',
          periodStart: {
            gte: new Date(3600_000),
            lte: new Date(3600_000),
          },
        },
        orderBy: { periodStart: 'asc' },
      });
    });

    it('gap-fills missing buckets with null OHLC (not carry-forward)', async () => {
      const mockPool = { id: 'pool-1' };
      const mockCandles = [
        {
          id: 'candle-1',
          poolId: 'pool-1',
          interval: '1h',
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          volumeUsd: 100,
          periodStart: new Date(0),
          pool: null,
        },
        {
          id: 'candle-2',
          poolId: 'pool-1',
          interval: '1h',
          open: 12,
          high: 13,
          low: 11,
          close: 12.5,
          volumeUsd: 200,
          periodStart: new Date(7200_000),
          pool: null,
        },
      ];
      mockPrisma.pool.findFirst.mockResolvedValueOnce(mockPool as never);
      mockPrisma.priceCandle.findMany.mockResolvedValueOnce(
        mockCandles as never,
      );

      const result = await service.getCandles('USDC', 'XLM', '1h', 0, 7200, 10);

      expect(result.candles).toHaveLength(3);
      expect(result.candles[0].close).toBe(10.5);
      expect(result.candles[1]).toEqual(nullCandle(3600));
      expect(result.candles[2].close).toBe(12.5);
    });
  });
});
