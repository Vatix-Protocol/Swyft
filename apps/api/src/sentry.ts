/**
 * Thin Sentry wrapper.
 * Sentry is only active when SENTRY_DSN is set and NODE_ENV !== 'test'.
 * Uses dynamic require so the app starts cleanly even if @sentry/node is not installed.
 */

let Sentry: any = null;

/**
 * Scrubbing patterns for sensitive data.
 * Applied in the beforeSend hook to prevent PII leakage to Sentry.
 */
const SENSITIVE_PATTERNS = {
  // Stellar wallet addresses: 56 chars, base32, start with 'G'
  walletAddress: /\bG[A-Z2-7]{55}\b/g,
  // Nonce values: 32 chars hex after 'nonce:', case-insensitive
  nonce: /nonce["\s:=]*:?["\s]?([a-f0-9]{32,}|[a-zA-Z0-9+/]{40,})/gi,
  // Environment-like keys in URLs/logs
  token: /(["\s]token["\s]*[:=]\s*)[^\s"]+/gi,
  signature: /(["\s]signature["\s]*[:=]\s*)[^\s"]+/gi,
};

/**
 * Recursively redacts sensitive values in an object/string.
 * Preserves structure but replaces matched patterns with [REDACTED].
 */
function redactSensitiveData(
  value: unknown,
  depth = 0,
): unknown {
  // Prevent infinite recursion on deeply nested objects
  if (depth > 50) return value;

  if (typeof value === 'string') {
    let redacted = value;
    for (const [, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactSensitiveData(v, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      // Redact sensitive keys directly
      if (
        typeof val === 'string' &&
        ['walletAddress', 'nonce', 'signature', 'token', 'secret', 'password', 'refreshToken', 'accessToken'].some(
          (k) => key.toLowerCase().includes(k.toLowerCase()),
        )
      ) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(val, depth + 1);
      }
    }
    return redacted;
  }

  return value;
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NODE_ENV === 'test') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      beforeSend(event: any) {
        // Redact sensitive data from breadcrumbs, context, and exception messages
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((bc: any) => ({
            ...bc,
            message: typeof bc.message === 'string' ? redactSensitiveData(bc.message) : bc.message,
            data: redactSensitiveData(bc.data),
          }));
        }

        if (event.contexts) {
          event.contexts = redactSensitiveData(event.contexts);
        }

        if (event.extra) {
          event.extra = redactSensitiveData(event.extra);
        }

        if (event.request) {
          event.request = redactSensitiveData(event.request);
        }

        if (event.exception) {
          event.exception = event.exception.map((ex: any) => ({
            ...ex,
            value: typeof ex.value === 'string' ? redactSensitiveData(ex.value) : ex.value,
          }));
        }

        return event;
      },
    });
  } catch {
    // @sentry/node not installed — Sentry stays disabled
  }
}

export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
) {
  if (!Sentry) return;
  Sentry.withScope(
    (scope: { setExtras: (c: Record<string, unknown>) => void }) => {
      if (context) scope.setExtras(context);
      Sentry.captureException(err);
    },
  );
}

export function setRequestContext(
  requestId: string,
  path: string,
  method: string,
  wallet?: string,
) {
  if (!Sentry) return;
  Sentry.getCurrentScope().setTags({ requestId, path, method });
  if (wallet) Sentry.getCurrentScope().setUser({ id: wallet });
}
