import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

export const TTL = {
  SPOT_PRICE: 5,
  POOL_LIST: 30,
  POOL_DETAIL: 15,
  CANDLES_SLOW: 60, // 1h / 1d candles
  CANDLES_FAST: 10, // 1m / 5m candles
  TICKS: 10,
  STATS: 300,       // pool stats aggregation runs every 5 min; match its window
} as const;

/** Stable error codes for cache entrypoints (safe to surface to callers/logs). */
export const CACHE_ERROR = {
  DEPENDENCY_UNAVAILABLE: 'CACHE_DEPENDENCY_UNAVAILABLE',
  FETCH_FAILED: 'CACHE_FETCH_FAILED',
} as const;

export type CacheErrorCode = (typeof CACHE_ERROR)[keyof typeof CACHE_ERROR];

export class CacheError extends Error {
  constructor(
    readonly code: CacheErrorCode,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'CacheError';
  }
}

export interface CacheFetchOptions {
  /** TTL (seconds) applied to the freshly fetched value. */
  ttlSeconds?: number;
  /** Correlation id propagated to logs/errors for tracing. */
  correlationId?: string;
  /**
   * Fail-closed mode for money-path reads/writes: when the cache dependency is
   * unavailable, throw instead of silently returning stale/incorrect data.
   */
  failClosed?: boolean;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private available = false;

  /**
   * In-flight single-flight map: coalesces concurrent cache misses for the same
   * key so only one upstream fetch runs (stampede protection).
   */
  private readonly inflight = new Map<string, Promise<unknown>>();

  onModuleInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.client.on('connect', () => {
      this.available = true;
      this.logger.log('Redis connected');
    });
    this.client.on('error', (err) => {
      this.available = false;
      this.logger.warn(
        `Redis unavailable — falling back to DB. ${err.message}`,
      );
    });

    this.client.connect().catch(() => {
      /* handled by error event */
    });
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  /** Creates a dedicated Redis connection for pub/sub (must be managed by caller). */
  createSubscriber(): Redis {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    return new Redis(url, { lazyConnect: false, enableOfflineQueue: true });
  }

  /** Publish a message to a Redis pub/sub channel. */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.client!.publish(channel, message);
    } catch {
      /* degrade gracefully */
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const raw = await this.client!.get(key);
      if (raw === null) {
        this.logger.debug(`cache miss  key=${key}`);
        return null;
      }
      this.logger.debug(`cache hit   key=${key}`);
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Read-through with single-flight coalescing.
   *
   * Concurrent misses for the same key share one upstream `fetcher` call, so a
   * burst of requests cannot stampede the DB/RPC. The result is written back to
   * Redis (best-effort) and returned to every waiter.
   *
   * Fail-closed: when `failClosed` is set and the cache dependency is
   * unavailable, a `CacheError` is thrown instead of silently fetching/returning
   * potentially stale liquidity/trading/settlement data.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheFetchOptions = {},
  ): Promise<T> {
    const { ttlSeconds, correlationId, failClosed = false } = options;

    if (failClosed && !this.available) {
      throw new CacheError(
        CACHE_ERROR.DEPENDENCY_UNAVAILABLE,
        `Cache dependency unavailable for key=${key}`,
        correlationId,
      );
    }

    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.logger.debug(`cache coalesce key=${key}`);
      return existing;
    }

    const pending = (async (): Promise<T> => {
      try {
        const value = await fetcher();
        await this.set(key, value, ttlSeconds);
        return value;
      } catch (err) {
        if (failClosed) {
          throw new CacheError(
            CACHE_ERROR.FETCH_FAILED,
            `Upstream fetch failed for key=${key}`,
            correlationId,
          );
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, pending);
    return pending;
  }

  async ping(): Promise<boolean> {
    if (!this.available) return false;
    try {
      return (await this.client!.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.available) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds === undefined) {
        await this.client!.set(key, serialized);
      } else {
        await this.client!.set(key, serialized, 'EX', ttlSeconds);
      }
    } catch {
      /* degrade gracefully */
    }
  }

  /**
   * Persist a numeric high-water mark without allowing an older concurrent
   * worker to move it backwards. The Redis script makes the read/compare/write
   * atomic across all indexer worker processes.
   */
  async setMaxNumber(key: string, value: number): Promise<boolean> {
    if (!this.available || !Number.isSafeInteger(value) || value < 0) {
      return false;
    }

    try {
      const updated = await this.client!.eval(
        `local current = redis.call('GET', KEYS[1])
         if not current or not tonumber(current) or tonumber(ARGV[1]) > tonumber(current) then
           redis.call('SET', KEYS[1], ARGV[1])
           return 1
         end
         return 0`,
        1,
        key,
        String(value),
      );
      return updated === 1;
    } catch {
      // Indexing must not fail merely because its observability checkpoint is
      // temporarily unavailable. The next successfully processed job retries it.
      return false;
    }
  }

  async invalidate(key: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.client!.del(key);
    } catch {
      /* degrade gracefully */
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.available) return;
    try {
      const keys = await this.client!.keys(pattern);
      if (keys.length) await this.client!.del(...keys);
    } catch {
      /* degrade gracefully */
    }
  }
}
