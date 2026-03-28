import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { CacheService, TTL } from '../cache/cache.service';

export interface PriceEvent {
  poolId: string;
  currentPrice: string;
  sqrtPrice: string;
  change24h: string;
  timestamp: number;
}

export interface PriceCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

@Injectable()
export class PriceService {
  private subscriptions = new Map<string, Set<WebSocket>>();
  private clientPools = new Map<WebSocket, Set<string>>();

  constructor(private readonly cache: CacheService) {}

  subscribe(client: WebSocket, poolId: string): void {
    if (!this.subscriptions.has(poolId)) {
      this.subscriptions.set(poolId, new Set());
    }
    this.subscriptions.get(poolId)!.add(client);

    if (!this.clientPools.has(client)) {
      this.clientPools.set(client, new Set());
    }
    this.clientPools.get(client)!.add(poolId);
  }

  unsubscribe(client: WebSocket, poolId: string): void {
    this.subscriptions.get(poolId)?.delete(client);
    this.clientPools.get(client)?.delete(poolId);
  }

  removeClient(client: WebSocket): void {
    const pools = this.clientPools.get(client);
    if (pools) {
      for (const poolId of pools) {
        this.subscriptions.get(poolId)?.delete(client);
      }
      this.clientPools.delete(client);
    }
  }

  async getSpotPrice(poolId: string): Promise<PriceEvent | null> {
    const key = `price:spot:${poolId}`;
    const cached = await this.cache.get<PriceEvent>(key);
    if (cached) return cached;
    // TODO: fetch from DB/RPC and populate
    return null;
  }

  broadcastPrice(event: PriceEvent): void {
    const key = `price:spot:${event.poolId}`;
    void this.cache.set(key, event, TTL.SPOT_PRICE);

    const clients = this.subscriptions.get(event.poolId);
    if (!clients?.size) return;

    const payload = JSON.stringify({ event: 'price', data: event });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
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
}
