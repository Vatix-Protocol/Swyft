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
 * Connection is resolved from `REDIS_URL` when set; otherwise the
 * individual `REDIS_HOST`/`REDIS_PORT` vars are used with the defaults
 * below.  `REDIS_URL` takes precedence, so a deployment that sets both
 * is driven by the URL alone.
 *
 * Required env vars:
 *   REDIS_URL    — Redis connection string (redis:// or rediss://).
 *                  Defaults to redis://localhost:6379 when unset.
 *   REDIS_HOST   — default: 'localhost' (ignored when REDIS_URL is set)
 *   REDIS_PORT   — default: 6379 (ignored when REDIS_URL is set)
 *   REDIS_PASSWORD — optional; applied only when set (URL password wins)
 *   REDIS_TLS    — set to exactly 'true' to enable TLS. Any other value
 *                  (including '1') leaves TLS disabled.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const redisUrl = config.get<string>('REDIS_URL');

        const host = config.get<string>('REDIS_HOST') ?? 'localhost';
        const port = config.get<number>('REDIS_PORT') ?? 6379;
        const password = config.get<string>('REDIS_PASSWORD');
        const tls = config.get<string>('REDIS_TLS') === 'true';

        // Resolve the URL before the host/port defaults so a URL, when
        // present, drives the connection.  A rediss:// scheme enables TLS
        // regardless of REDIS_TLS.
        let resolvedHost = host;
        let resolvedPort = port;
        let resolvedPassword = password;
        let resolvedTls = tls;

        if (redisUrl) {
          const url = new URL(redisUrl);
          resolvedHost = url.hostname;
          resolvedPort = url.port ? Number(url.port) : 6379;
          if (url.password) {
            resolvedPassword = url.password;
          }
          if (url.protocol === 'rediss:') {
            resolvedTls = true;
          }
        }

        return new Redis({
          host: resolvedHost,
          port: resolvedPort,
          // Password is omitted entirely when unset so deployments that
          // don't use auth never send a password field.
          ...(resolvedPassword ? { password: resolvedPassword } : {}),
          ...(resolvedTls ? { tls: {} } : {}),
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
