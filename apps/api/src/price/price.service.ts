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

/**
 * OHLCV candle for a fixed interval bucket.
 *
 * OHLC/volume are decimal strings exactly as stored in the database, so
 * clients receive the precise value (e.g. `"0.1"`) rather than a binary
 * float approximation. The chart client parses them if it needs a number.
 *
 * Gap policy (null buckets): when no trades occurred in a bucket inside the
 * requested `[from, to]` range, the API returns an explicit null candle —
 * `open`/`high`/`low`/`close`/`volume` are all `null`. Gaps are never
 * carry-forward filled. See `docs/CANDLE_GAP_POLICY.md`.
 */
export interface PriceCandle {
  time: number;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string | null;
}

/** Build an explicit null-bucket candle for a missing interval. */
export function nullCandle(time: number): PriceCandle {
  return {
    time,
    open: null,
    high: null,
    low: null,
    close: null,
    volume: null,
  };
}

/**
 * Align `from`/`to` unix seconds onto interval boundaries and insert
 * null-bucket candles for any missing period in the closed range.
 *
 * Existing candles are left unchanged; only absent buckets are filled with
 * null OHLC/volume (never carry-forward).
 */
export function fillCandleGaps(
  candles: PriceCandle[],
  intervalSec: number,
  from: number,
  to: number,
  limit: number,
): PriceCandle[] {
  if (intervalSec <= 0 || limit <= 0) return [];

  const start = Math.floor(from / intervalSec) * intervalSec;
  const end = Math.floor(to / intervalSec) * intervalSec;
  if (end < start) return [];

  const byTime = new Map<number, PriceCandle>();
  for (const c of candles) {
    byTime.set(c.time, c);
  }

  const filled: PriceCandle[] = [];
  for (let t = start; t <= end && filled.length < limit; t += intervalSec) {
    filled.push(byTime.get(t) ?? nullCandle(t));
  }
  return filled;
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
        void this.subscriber
          .subscribe(...channels)
          .catch((error: unknown) =>
            this.logger.warn(`Price re-subscription failed: ${String(error)}`),
          );
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

    if (isNew) {
      void this.subscriber
        .subscribe(`prices:${poolId}`)
        .catch((error: unknown) =>
          this.logger.warn(`Price subscription failed: ${String(error)}`),
        );
    }
  }

  unsubscribe(client: WebSocket, poolId: string): void {
    const pool = this.subscriptions.get(poolId);
    if (pool) {
      pool.delete(client);
      if (pool.size === 0) {
        this.subscriptions.delete(poolId);
        void this.subscriber
          .unsubscribe(`prices:${poolId}`)
          .catch((error: unknown) =>
            this.logger.warn(`Price unsubscribe failed: ${String(error)}`),
          );
      }
    }
    this.clientPools.get(client)?.delete(poolId);
  }

  /** Number of pools a given client is currently subscribed to. */
  getSubscriptionCount(client: WebSocket): number {
    return this.clientPools.get(client)?.size ?? 0;
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
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(payload);
      } catch (error) {
        this.removeClient(client);
        this.logger.warn(`Price broadcast failed: ${String(error)}`);
      }
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
      select: { id: true },
    });

    if (!pool) {
      throw new NotFoundException(
        `No pool found for token pair ${tokenA}/${tokenB}`,
      );
    }

    const intervalSec = this.intervalToSeconds(interval);
    const rows = await this.prisma.candle.findMany({
      where: {
        poolId: pool.id,
        interval,
        time: { gte: from, lte: to },
      },
      orderBy: { time: 'asc' },
      take: limit,
    });

    const candles: PriceCandle[] = rows.map((row) => ({
      time: row.time,
      open: row.open.toString(),
      high: row.high.toString(),
      low: row.low.toString(),
      close: row.close.toString(),
      volume: row.volume.toString(),
    }));

    return {
      poolId: pool.id,
      candles: fillCandleGaps(candles, intervalSec, from, to, limit),
    };
  }

  private intervalToSeconds(interval: string): number {
    const match = /^(\d+)([smhd])$/.exec(interval);
    if (!match) return 60;
    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return 60;
    }
  }
}
