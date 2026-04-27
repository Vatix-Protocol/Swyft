/**
 * Thin Sentry wrapper.
 * Sentry is only active when SENTRY_DSN is set and NODE_ENV !== 'test'.
 * Uses dynamic require so the app starts cleanly even if @sentry/node is not installed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;

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
    });
  } catch {
    // @sentry/node not installed — Sentry stays disabled
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!Sentry) return;
  Sentry.withScope((scope: { setExtras: (c: Record<string, unknown>) => void }) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
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
