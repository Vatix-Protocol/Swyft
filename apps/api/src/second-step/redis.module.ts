import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';

/**
 * Application-wide Redis module.
 *
 * Provides a single shared `Redis` (ioredis) instance under the
 * `REDIS_CLIENT` injection token.  Import this module wherever Redis
 * access is needed.
 *
 * Required env vars:
 *   REDIS_HOST  — default: 'localhost'
 *   REDIS_PORT  — default: 6379
 *   REDIS_PASSWORD — optional
 *   REDIS_TLS   — set to 'true' to enable TLS (e.g. Railway Redis)
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const host = config.get<string>('REDIS_HOST') ?? 'localhost';
        const port = config.get<number>('REDIS_PORT') ?? 6379;
        const password = config.get<string>('REDIS_PASSWORD');
        const tls = config.get<string>('REDIS_TLS') === 'true';

        return new Redis({
          host,
          port,
          ...(password ? { password } : {}),
          ...(tls ? { tls: {} } : {}),
          // Fail fast on connection problems during boot rather than
          // silently queuing commands indefinitely.
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
