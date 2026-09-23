import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from './cache/cache.module';

/**
 * CORS configuration for the API.
 *
 * Deny-by-default: only origins explicitly listed in the environment are
 * allowed. Credentialed requests never use a wildcard origin. See
 * docs/CORS-CONFIG.md for the production allowlist contract.
 */
export interface CorsConfig {
  origins: string[];
  credentials: boolean;
}

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

/**
 * Parse a comma-separated origin allowlist from the environment.
 * Returns a de-duplicated, trimmed list. Empty entries are dropped so a
 * malformed value fails closed (no origins allowed) rather than opening up.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const origin = entry.trim();
    if (origin.length > 0) {
      seen.add(origin);
    }
  }
  return Array.from(seen);
}

/**
 * Resolve the effective CORS config for the current environment.
 *
 * - Production/mainnet: requires an explicit allowlist; never falls back to
 *   localhost and never allows a wildcard when credentials are enabled.
 * - Non-production: falls back to local dev origins when unset.
 */
export function resolveCorsConfig(env: NodeJS.ProcessEnv = process.env): CorsConfig {
  const isProduction = env.NODE_ENV === 'production';
  const configured = parseCorsOrigins(env.CORS_ALLOWED_ORIGINS);

  let origins = configured;
  if (origins.length === 0 && !isProduction) {
    origins = DEFAULT_DEV_ORIGINS;
  }

  // Credentials require an explicit allowlist; a wildcard is never permitted.
  const credentials = env.CORS_ALLOW_CREDENTIALS === 'true';
  if (credentials) {
    origins = origins.filter((origin) => origin !== '*');
  }

  return { origins, credentials };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule,
  ],
})
export class AppModule {
  static corsOptions(config: ConfigService) {
    const { origins, credentials } = resolveCorsConfig({
      ...process.env,
      CORS_ALLOWED_ORIGINS:
        config.get<string>('CORS_ALLOWED_ORIGINS') ?? process.env.CORS_ALLOWED_ORIGINS,
      CORS_ALLOW_CREDENTIALS:
        config.get<string>('CORS_ALLOW_CREDENTIALS') ?? process.env.CORS_ALLOW_CREDENTIALS,
    });

    return {
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Same-origin / non-browser requests have no Origin header.
        if (!origin) {
          return callback(null, true);
        }
        if (origins.includes(origin)) {
          return callback(null, true);
        }
        // Fail closed: reject unlisted origins instead of reflecting them.
        return callback(null, false);
      },
      credentials,
    };
  }
}
