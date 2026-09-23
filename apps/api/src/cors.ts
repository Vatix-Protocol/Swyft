/**
 * Get allowed CORS origins based on environment.
 *
 * **Development mode:**
 * - Defaults to http://localhost:3000 if WEB_APP_ORIGIN or CORS_ORIGIN not set
 * - Allows local development with implicit fallback
 *
 * **Production mode (NODE_ENV=production):**
 * - Requires explicit WEB_APP_ORIGIN or CORS_ORIGIN — no fallback to localhost
 * - Throws error if neither env var is configured
 * - Rejects any origin not in the allowlist
 * - Rejects localhost/127.0.0.1 and the wildcard '*' (invalid alongside
 *   the always-on `credentials: true`)
 *
 * **Env vars:**
 * - `WEB_APP_ORIGIN`: Comma-separated list of allowed origins (e.g., "https://app.example.com,https://www.example.com")
 * - `CORS_ORIGIN`: Fallback if WEB_APP_ORIGIN not set. Same format.
 *
 * **Example:**
 * ```bash
 * export WEB_APP_ORIGIN="https://swyft.example,https://www.swyft.example"
 * ```
 */
export function getCorsOrigins(): string[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const raw = process.env.WEB_APP_ORIGIN ?? process.env.CORS_ORIGIN ?? null;

  if (!raw) {
    if (isProduction) {
      throw new Error(
        'Production CORS: WEB_APP_ORIGIN or CORS_ORIGIN must be set. ' +
          'No fallback to localhost allowed in production.',
      );
    }
    return ['http://localhost:3000'];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Validate CORS configuration at startup (called in main.ts).
 * In production, ensures at least one origin is explicitly configured.
 */
export function validateCorsConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const origins = getCorsOrigins();
    if (origins.length === 0) {
      throw new Error(
        'Production CORS validation failed: no valid origins in WEB_APP_ORIGIN or CORS_ORIGIN',
      );
    }

    const hasLocalhost = origins.some(
      (origin) => origin.includes('localhost') || origin.includes('127.0.0.1'),
    );
    if (hasLocalhost) {
      throw new Error(
        `Production CORS validation failed: localhost/127.0.0.1 not allowed in production. ` +
          `Found: ${origins.join(', ')}`,
      );
    }

    // `credentials: true` is always set in main.ts. A wildcard origin combined
    // with credentialed requests is an invalid/unsafe CORS config — browsers
    // reject it, but some proxies/middleware fail open by reflecting the
    // request origin instead of the literal '*'. Fail closed at startup.
    const hasWildcard = origins.some((origin) => origin === '*');
    if (hasWildcard) {
      throw new Error(
        `Production CORS validation failed: wildcard origin '*' is not allowed in production ` +
          `(credentials are enabled, and '*' cannot be combined with credentialed requests). ` +
          `Found: ${origins.join(', ')}`,
      );
    }
  }
}
