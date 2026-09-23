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

/**
 * Rate limiting configuration for the API.
 *
 * Deny-by-default: every external entrypoint is rate limited. The backing
 * store (Redis) is required for writes; when it is unavailable the limiter
 * fails closed so untrusted clients cannot bypass policy. See
 * docs/RATE_LIMITING.md for the production contract.
 */
export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  max: number;
  /** Fail closed on writes when the backing store is unavailable. */
  failClosed: boolean;
}

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 120;

/**
 * Resolve the effective rate-limit config for the current environment.
 *
 * - Production/mainnet: rate limiting is always enabled and fails closed.
 * - Non-production: can be disabled via RATE_LIMIT_ENABLED=false for local
 *   development, but defaults to enabled.
 */
export function resolveRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitConfig {
  const isProduction = env.NODE_ENV === 'production';

  const windowMs = Number.parseInt(env.RATE_LIMIT_WINDOW_MS ?? '', 10);
  const max = Number.parseInt(env.RATE_LIMIT_MAX ?? '', 10);

  // Production cannot be disabled; non-production defaults to enabled.
  const enabled = isProduction ? true : env.RATE_LIMIT_ENABLED !== 'false';

  return {
    enabled,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_RATE_LIMIT_WINDOW_MS,
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_RATE_LIMIT_MAX,
    // Writes always fail closed; production never relaxes this.
    failClosed: isProduction ? true : env.RATE_LIMIT_FAIL_CLOSED !== 'false',
  };
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

  static rateLimitOptions(config: ConfigService): RateLimitConfig {
    return resolveRateLimitConfig({
      ...process.env,
      RATE_LIMIT_ENABLED:
        config.get<string>('RATE_LIMIT_ENABLED') ?? process.env.RATE_LIMIT_ENABLED,
      RATE_LIMIT_WINDOW_MS:
        config.get<string>('RATE_LIMIT_WINDOW_MS') ?? process.env.RATE_LIMIT_WINDOW_MS,
      RATE_LIMIT_MAX:
        config.get<string>('RATE_LIMIT_MAX') ?? process.env.RATE_LIMIT_MAX,
      RATE_LIMIT_FAIL_CLOSED:
        config.get<string>('RATE_LIMIT_FAIL_CLOSED') ?? process.env.RATE_LIMIT_FAIL_CLOSED,
    });
  }
}
