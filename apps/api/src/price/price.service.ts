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
    return this.cache.get<PriceEvent>(`price:spot:${poolId}`);
  }

  broadcastPrice(event: PriceEvent): void {
    const clients = this.subscriptions.get(event.poolId);
    if (!clients?.size) return;

    const payload = JSON.stringify({ event: 'price', data: event });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
