/**
 * Validates and exposes DATABASE_URL / REDIS_URL via `@nestjs/config`.
 *
 * Registered as a `load[]` factory in `ConfigModule.forRoot`, which resolves
 * before `PrismaModule` / `CacheModule` / BullMQ queues in `AppModule`'s
 * imports — so a malformed or missing URL crashes at boot, before any
 * worker or DB client attempts a connection.
 *
 * Required env vars (see apps/api/.env.example):
 *   DATABASE_URL — Postgres connection string (required in every environment)
 *   REDIS_URL    — Redis connection string (default: redis://localhost:6379
 *                  outside production; required explicitly in production)
 */

import { registerAs } from '@nestjs/config';
import { Matches, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export const INFRA_CONFIG_KEY = 'infra';

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/;
const REDIS_URL_PATTERN = /^rediss?:\/\/.+/;
const REDIS_DEFAULT = 'redis://localhost:6379';

class InfraEnvVars {
  @Matches(POSTGRES_URL_PATTERN, {
    message: 'DATABASE_URL must be a valid postgres:// or postgresql:// URL',
  })
  DATABASE_URL!: string;

  @Matches(REDIS_URL_PATTERN, {
    message: 'REDIS_URL must be a valid redis:// or rediss:// URL',
  })
  REDIS_URL: string = REDIS_DEFAULT;
}

export interface InfraConfig {
  databaseUrl: string;
  redisUrl: string;
}

export const infraConfig = registerAs(INFRA_CONFIG_KEY, (): InfraConfig => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const missing: string[] = [];
    if (!process.env.DATABASE_URL) {
      missing.push('DATABASE_URL: must be set in production');
    }
    if (!process.env.REDIS_URL) {
      missing.push('REDIS_URL: must be set in production');
    }
    if (missing.length > 0) {
      throw new Error(
        `Infra configuration is invalid:\n${missing.map((m) => `  ${m}`).join('\n')}`,
      );
    }
  }

  const env = plainToInstance(InfraEnvVars, {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL ?? REDIS_DEFAULT,
  });

  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Infra configuration is invalid:\n${details}`);
  }

  return {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
  };
});
