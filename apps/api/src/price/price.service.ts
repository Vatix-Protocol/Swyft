import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { WebSocket } from 'ws';
import { CacheService, TTL } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PriceEvent {
  poolId: string;
  currentPrice: string;
  sqrtPrice: string;
  tick: number;
  liquidity: string;
  timestamp: number;
  change24h?: string;
}

export interface SpotPriceResponse {
  tokenA: string;
  tokenB: string;
  spotPrice: string;
  change24hAbsolute: string;
  change24hPercent: string;
  high24h: string;
  low24h: string;
  lastUpdated: string;
}

export function normalizePair(a: string, b: string): [string, string] {
  return a.toLowerCase() < b.toLowerCase()
    ? [a.toLowerCase(), b.toLowerCase()]
    : [b.toLowerCase(), a.toLowerCase()];
}

export function spotPriceCacheKey(tokenA: string, tokenB: string): string {
  const [a, b] = normalizePair(tokenA, tokenB);
  return `price:spot:${a}:${b}`;
}

export interface PriceCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private subscriber!: Redis;

  /** poolId → connected WebSocket clients */
  private subscriptions = new Map<string, Set<WebSocket>>();
  /** client → poolIds it subscribed to */
  private clientPools = new Map<WebSocket, Set<string>>();

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.subscriber = this.cache.createSubscriber();

    this.subscriber.on('message', (channel: string, message: string) => {
      const poolId = channel.replace(/^prices:/, '');
      try {
        const event = JSON.parse(message) as PriceEvent;
        this.broadcastPrice(event);
        void this.cache.set(`price:spot:${poolId}`, event, TTL.SPOT_PRICE);
      } catch {
        this.logger.warn(`Bad pub/sub message on ${channel}`);
      }
    });

    // Re-subscribe to all active channels after a reconnect.
    this.subscriber.on('ready', () => {
      const channels = [...this.subscriptions.keys()].map(
        (id) => `prices:${id}`,
      );
      if (channels.length) {
        void this.subscriber.subscribe(...channels);
        this.logger.log(`Re-subscribed to ${channels.length} channel(s)`);
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
  }

  subscribe(client: WebSocket, poolId: string): void {
    const isNew = !this.subscriptions.has(poolId);
    if (isNew) this.subscriptions.set(poolId, new Set());
    this.subscriptions.get(poolId)!.add(client);

    if (!this.clientPools.has(client)) this.clientPools.set(client, new Set());
    this.clientPools.get(client)!.add(poolId);

    if (isNew) void this.subscriber.subscribe(`prices:${poolId}`);
  }

  unsubscribe(client: WebSocket, poolId: string): void {
    const pool = this.subscriptions.get(poolId);
    if (pool) {
      pool.delete(client);
      if (pool.size === 0) {
        this.subscriptions.delete(poolId);
        void this.subscriber.unsubscribe(`prices:${poolId}`);
      }
    }
    this.clientPools.get(client)?.delete(poolId);
  }

  removeClient(client: WebSocket): void {
    const pools = this.clientPools.get(client);
    if (pools) {
      for (const poolId of pools) this.unsubscribe(client, poolId);
      this.clientPools.delete(client);
    }
  }

  async getSpotPrice(poolId: string): Promise<PriceEvent | null> {
    const key = `price:spot:${poolId}`;
    const cached = await this.cache.get<PriceEvent>(key);
    if (cached) return cached;
    return null;
  }

  async getTokenPairPrice(
    tokenA: string,
    tokenB: string,
  ): Promise<SpotPriceResponse> {
    const key = spotPriceCacheKey(tokenA, tokenB);
    const cached = await this.cache.get<SpotPriceResponse>(key);
    if (cached) return cached;

    const event = await this.getSpotPrice(key);
    if (!event) {
      throw new NotFoundException(
        `No pool found for token pair ${tokenA}/${tokenB}`,
      );
    }

    const price = parseFloat(event.currentPrice);
    const change = parseFloat(event.change24h ?? '0');
    const changePercent =
      price - change !== 0 ? (change / Math.abs(price - change)) * 100 : 0;

    const response: SpotPriceResponse = {
      tokenA: tokenA.toLowerCase(),
      tokenB: tokenB.toLowerCase(),
      spotPrice: event.currentPrice,
      change24hAbsolute: event.change24h ?? '0',
      change24hPercent: changePercent.toFixed(4),
      high24h: event.currentPrice,
      low24h: event.currentPrice,
      lastUpdated: new Date(event.timestamp).toISOString(),
    };

    await this.cache.set(key, response, TTL.SPOT_PRICE);
    return response;
  }

  broadcastPrice(event: PriceEvent): void {
    const clients = this.subscriptions.get(event.poolId);
    if (!clients?.size) return;

    const payload = JSON.stringify({ event: 'price', data: event });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  async getCandles(
    tokenA: string,
    tokenB: string,
    interval: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<{ poolId: string; candles: PriceCandle[] }> {
    const tokenALower = tokenA.toLowerCase();
    const tokenBLower = tokenB.toLowerCase();

    const pool = await this.prisma.pool.findFirst({
      where: {
        OR: [
          {
            token0Address: { equals: tokenALower, mode: 'insensitive' },
            token1Address: { equals: tokenBLower, mode: 'insensitive' },
          },
          {
            token0Address: { equals: tokenBLower, mode: 'insensitive' },
            token1Address: { equals: tokenALower, mode: 'insensitive' },
          },
        ],
      },
    });

    if (!pool) {
      throw new NotFoundException(
        `No pool found for token pair ${tokenA}/${tokenB}`,
      );
    }

    const fromDate = new Date(from * 1000);
    const toDate = new Date(to * 1000);

    const priceCandles = await this.prisma.priceCandle.findMany({
      where: {
        poolId: pool.id,
        interval,
        periodStart: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: { periodStart: 'asc' },
      take: limit,
    });

    const candles = priceCandles.map((candle) => ({
      time: Math.floor(candle.periodStart.getTime() / 1000),
      open: parseFloat(candle.open.toString()),
      high: parseFloat(candle.high.toString()),
      low: parseFloat(candle.low.toString()),
      close: parseFloat(candle.close.toString()),
      volume: parseFloat(candle.volumeUsd.toString()),
    }));

    return { poolId: pool.id, candles };
  }

  private getIntervalSeconds(interval: string): number {
    switch (interval) {
      case '1m':
        return 60;
      case '5m':
        return 300;
      case '1h':
        return 3600;
      case '1d':
        return 86400;
      default:
        return 3600;
    }
  }

  async invalidatePairCache(tokenA: string, tokenB: string): Promise<void> {
    const key = spotPriceCacheKey(tokenA, tokenB);
    await this.cache.invalidate(key);
  }
}
