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
} as const;

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private available = false;

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

  /**
   * Acquires a singleflight lock for a key.
   *
   * Returns true if the lock was acquired (this process should load the data),
   * or false if another process already holds the lock (wait for result).
   *
   * Lock is stored as `${key}:lock` and expires in `lockTtlSeconds`.
   *
   * @param key - Cache key to lock
   * @param lockTtlSeconds - TTL for the lock in seconds (default 5)
   * @returns true if lock acquired, false if already locked
   */
  async acquireSingleflightLock(
    key: string,
    lockTtlSeconds = 5,
  ): Promise<boolean> {
    if (!this.available) return true; // If Redis is down, allow load
    try {
      const lockKey = `${key}:lock`;
      // SET NX EX: set only if not exists, expire in lockTtlSeconds
      const result = await this.client!.set(
        lockKey,
        '1',
        'EX',
        lockTtlSeconds,
        'NX',
      );
      return result === 'OK';
    } catch {
      return true; // If Redis fails, allow load
    }
  }

  /**
   * Releases a singleflight lock.
   *
   * @param key - Cache key that was locked
   */
  async releaseSingleflightLock(key: string): Promise<void> {
    if (!this.available) return;
    try {
      const lockKey = `${key}:lock`;
      await this.client!.del(lockKey);
    } catch {
      /* degrade gracefully */
    }
  }

  /**
   * Wait for a singleflight lock to be released, with timeout.
   *
   * Useful when another process holds the lock; this waits for the lock to
   * expire or be released before retrying the cache get.
   *
   * @param key - Cache key that is locked
   * @param maxWaitMs - Maximum time to wait in milliseconds (default 1000)
   * @param pollIntervalMs - Poll interval in milliseconds (default 50)
   * @returns true if lock was released, false if timeout
   */
  async waitForSingleflightLock(
    key: string,
    maxWaitMs = 1000,
    pollIntervalMs = 50,
  ): Promise<boolean> {
    if (!this.available) return true;

    const lockKey = `${key}:lock`;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const exists = await this.client!.exists(lockKey);
        if (exists === 0) {
          return true; // Lock released
        }
      } catch {
        return true; // If Redis fails, proceed
      }
      // Sleep before next poll
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return false; // Timeout
  }
}
