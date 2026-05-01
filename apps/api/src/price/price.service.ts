import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { WebSocket } from 'ws';
import { CacheService, TTL } from '../cache/cache.service';

export interface PriceEvent {
  poolId: string;
  currentPrice: string;
  sqrtPrice: string;
  tick: number;
  liquidity: string;
  timestamp: number;
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
export interface PriceCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private subscriber!: Redis;

  /** poolId → connected WebSocket clients */
  private subscriptions = new Map<string, Set<WebSocket>>();
  /** client → poolIds it subscribed to */
  private clientPools = new Map<WebSocket, Set<string>>();

  constructor(private readonly cache: CacheService) {}

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
    return this.cache.get<PriceEvent>(`price:spot:${poolId}`);
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
    const change = parseFloat(event.change24h);
    const changePercent =
      price - change !== 0 ? (change / Math.abs(price - change)) * 100 : 0;

    const response: SpotPriceResponse = {
      tokenA: tokenA.toLowerCase(),
      tokenB: tokenB.toLowerCase(),
      spotPrice: event.currentPrice,
      change24hAbsolute: event.change24h,
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
  ): Promise<PriceCandle[]> {
    // Mock implementation - in production this would query the PriceCandle table
    const candles: PriceCandle[] = [];
    const intervalSeconds = this.getIntervalSeconds(interval);
    
    for (let i = 0; i < limit; i++) {
      const timestamp = from + (i * intervalSeconds);
      if (timestamp > to) break;
      
      // Generate realistic-looking candle data
      const basePrice = 2000 + Math.random() * 100;
      const volatility = 0.02; // 2% volatility
      
      candles.push({
        timestamp,
        open: (basePrice + (Math.random() - 0.5) * basePrice * volatility).toFixed(2),
        high: (basePrice + Math.random() * basePrice * volatility).toFixed(2),
        low: (basePrice - Math.random() * basePrice * volatility).toFixed(2),
        close: (basePrice + (Math.random() - 0.5) * basePrice * volatility).toFixed(2),
        volume: (Math.random() * 1000000).toFixed(2),
      });
    }
    
    return candles;
  }

  private getIntervalSeconds(interval: string): number {
    switch (interval) {
      case '1m': return 60;
      case '5m': return 300;
      case '1h': return 3600;
      case '1d': return 86400;
      default: return 3600;
    }
  }

  async invalidatePairCache(tokenA: string, tokenB: string): Promise<void> {
    const key = spotPriceCacheKey(tokenA, tokenB);
    await this.cache.invalidate(key);
  }
}
