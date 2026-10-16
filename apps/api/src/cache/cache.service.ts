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
  STATS: 300, // pool stats aggregation runs every 5 min; match its window
  GLOBAL_STATS: 300, // platform-wide /stats/global cache window
  USD_PRICE: 600, // price:usd:* refreshed every 5 min; keep a stale-but-present buffer
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

/** Stable error codes for rate-limit entrypoints (safe to surface to callers/logs). */
export const RATE_LIMIT_ERROR = {
  EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  DEPENDENCY_UNAVAILABLE: 'RATE_LIMIT_DEPENDENCY_UNAVAILABLE',
} as const;

export type RateLimitErrorCode =
  (typeof RATE_LIMIT_ERROR)[keyof typeof RATE_LIMIT_ERROR];

export class RateLimitError extends Error {
  constructor(
    readonly code: RateLimitErrorCode,
    message: string,
    readonly correlationId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
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

export interface RateLimitOptions {
  /** Max requests permitted within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Correlation id propagated to logs/errors for tracing. */
  correlationId?: string;
  /**
   * Fail-closed mode for money-path entrypoints: when the rate-limit backing
   * store is unavailable, deny the request instead of allowing it through.
   */
  failClosed?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (only meaningful when not allowed). */
  retryAfterSeconds: number;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private available = false;

  /**
   * Subscribers handed out via `createSubscriber()`. Tracked so a caller that
   * forgets to quit its connection does not leak it past shutdown.
   */
  private readonly subscribers = new Set<Redis>();

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

    const outstanding = Array.from(this.subscribers);
    this.subscribers.clear();
    await Promise.all(
      outstanding.map(async (subscriber) => {
        try {
          await subscriber.quit();
        } catch {
          /* already closed or unreachable — nothing left to clean up */
        }
      }),
    );
  }

  /**
   * Creates a dedicated Redis connection for pub/sub.
   *
   * The returned client is tracked by this service and quit in
   * `onModuleDestroy`, so callers that forget to clean up do not leak a
   * connection. Callers that do manage it should call `releaseSubscriber()`
   * after quitting so it is dropped from tracking.
   */
  createSubscriber(): Redis {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const subscriber = new Redis(url, {
      lazyConnect: false,
      enableOfflineQueue: true,
    });
    this.subscribers.add(subscriber);
    return subscriber;
  }

  /**
   * Stops tracking a subscriber previously returned by `createSubscriber()`.
   * Call this after quitting the client yourself to avoid a redundant quit on
   * shutdown.
   */
  releaseSubscriber(client: Redis): void {
    this.subscribers.delete(client);
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

  /**
   * Fixed-window rate limiter backed by Redis.
   *
   * The INCR + EXPIRE pair runs atomically in a Lua script so concurrent
   * requests across API replicas share one counter and cannot race past the
   * limit. Deny-by-default: when the backing store is unavailable and
   * `failClosed` is set, the request is rejected with a typed `RateLimitError`
   * rather than being allowed through.
   */
  async checkRateLimit(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const { limit, windowSeconds, correlationId, failClosed = false } = options;

    if (!this.available) {
      if (failClosed) {
        throw new RateLimitError(
          RATE_LIMIT_ERROR.DEPENDENCY_UNAVAILABLE,
          `Rate-limit store unavailable for key=${key}`,
          correlationId,
        );
      }
      // Non-money-path: allow but surface no remaining budget.
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }

    try {
      const [count, ttl] = (await this.client!.eval(
        `local current = redis.call('INCR', KEYS[1])
         if current == 1 then
           redis.call('EXPIRE', KEYS[1], ARGV[1])
         end
         local ttl = redis.call('TTL', KEYS[1])
         return { current, ttl }`,
        1,
        key,
        String(windowSeconds),
      )) as [number, number];

      const remaining = Math.max(0, limit - count);
      const allowed = count <= limit;
      const retryAfterSeconds = allowed ? 0 : Math.max(1, ttl);

      if (!allowed) {
        this.logger.warn(
          `rate limit exceeded key=${key} count=${count} limit=${limit}`,
        );
      }

      return { allowed, remaining, retryAfterSeconds };
    } catch (err) {
      if (failClosed) {
        throw new RateLimitError(
          RATE_LIMIT_ERROR.DEPENDENCY_UNAVAILABLE,
          `Rate-limit store error for key=${key}`,
          correlationId,
        );
      }
      // Non-money-path: fail open but surface no remaining budget.
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.available) return;
    try {
      const raw = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client!.set(key, raw, 'EX', ttlSeconds);
      } else {
        await this.client!.set(key, raw);
      }
    } catch {
      /* degrade gracefully */
    }
  }

  async del(key: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.client!.del(key);
    } catch {
      /* degrade gracefully */
    }
  }
}
