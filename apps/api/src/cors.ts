export interface CorsConfig {
  /** Explicit, deny-by-default allowlist of origins permitted to call the API. */
  origins: string[];
  /** Whether credentialed requests (cookies/Authorization) are allowed. */
  credentials: boolean;
  /** Resolved environment used to select the allowlist. */
  environment: CorsEnvironment;
}

export type CorsEnvironment = 'production' | 'testnet' | 'development';

/**
 * Stable error code emitted when an origin is rejected by the allowlist.
 * Kept stable so ops/logs and clients can rely on it. Fail-closed by design.
 */
export const CORS_ORIGIN_DENIED = 'CORS_ORIGIN_DENIED' as const;

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000'];

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveEnvironment(): CorsEnvironment {
  const raw = (process.env.NODE_ENV ?? '').toLowerCase();
  if (raw === 'production') {
    return 'production';
  }
  if (raw === 'testnet' || raw === 'staging') {
    return 'testnet';
  }
  return 'development';
}

/**
 * Resolve the CORS allowlist for the current environment.
 *
 * Deny-by-default: production and testnet require an explicit allowlist via
 * `CORS_ALLOWED_ORIGINS` (or the legacy `WEB_APP_ORIGIN`/`CORS_ORIGIN`).
 * When no allowlist is configured in a non-development environment, an empty
 * list is returned so no origin is reflected. Development falls back to the
 * local web app origin only.
 */
export function getCorsConfig(): CorsConfig {
  const environment = resolveEnvironment();

  const configured = parseOrigins(
    process.env.CORS_ALLOWED_ORIGINS ??
      process.env.WEB_APP_ORIGIN ??
      process.env.CORS_ORIGIN,
  );

  const origins =
    configured.length > 0
      ? configured
      : environment === 'development'
        ? DEFAULT_DEV_ORIGINS
        : [];

  // Never allow wildcard origins when credentials are enabled.
  const credentials = process.env.CORS_ALLOW_CREDENTIALS !== 'false';
  const safeOrigins = credentials
    ? origins.filter((origin) => origin !== '*')
    : origins;

  return { origins: safeOrigins, credentials, environment };
}

/**
 * Backwards-compatible helper returning just the allowlisted origins.
 * Prefer {@link getCorsConfig} for new call sites.
 */
export function getCorsOrigins(): string[] {
  return getCorsConfig().origins;
}

/**
 * Fail-closed origin check. Returns the origin when it is explicitly
 * allowlisted, otherwise `false` so the caller omits CORS headers rather than
 * reflecting an untrusted origin.
 */
export function resolveCorsOrigin(
  origin: string | undefined,
  config: CorsConfig = getCorsConfig(),
): string | false {
  if (!origin) {
    return false;
  }
  return config.origins.includes(origin) ? origin : false;
}
