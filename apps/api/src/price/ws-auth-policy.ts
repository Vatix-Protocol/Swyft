import { IncomingMessage } from 'http';
import {
  JsonWebTokenError,
  TokenExpiredError,
  verify,
  VerifyOptions,
} from 'jsonwebtoken';
import { BoundedCounter } from '../observability/bounded-counter';
import { resolveCorrelationId } from '../observability/correlation-id';

/**
 * Authn policy for the `/price` pool-updates WebSocket (#1027).
 * Source of truth: docs/WEBSOCKET_RECONNECT.md § "Pool updates authn policy".
 *
 * Pool price updates are public market data, so operators may let
 * unauthenticated clients read them (`WS_POOL_UPDATES_AUTH_MODE=optional`).
 * Invariants that hold in every mode:
 *  - Default is `required`; an unknown mode value fails closed to `required`.
 *  - On mainnet, `optional` also needs `WS_POOL_UPDATES_ANON_MAINNET_ENABLED`.
 *  - A presented token is always verified. An invalid or expired token is
 *    rejected — it is never downgraded to an anonymous session.
 *  - Anonymous sessions can only read (subscribe/unsubscribe) and get a lower
 *    subscription cap. Anything with a side effect needs a wallet.
 *  - Tokens are never logged; metrics labels are a fixed enum.
 */

export const WS_ERROR_CODES = {
  AUTH_REQUIRED: 'WS_AUTH_REQUIRED',
  AUTH_INVALID: 'WS_AUTH_INVALID',
  AUTH_EXPIRED: 'WS_AUTH_EXPIRED',
  FORBIDDEN: 'WS_FORBIDDEN',
  INVALID_REQUEST: 'WS_INVALID_REQUEST',
  SUBSCRIPTION_LIMIT: 'WS_SUBSCRIPTION_LIMIT',
} as const;

export type WsErrorCode = (typeof WS_ERROR_CODES)[keyof typeof WS_ERROR_CODES];

/** Close code for handshake auth failures (HTTP 401 analogue). */
export const WS_CLOSE_UNAUTHORIZED = 4401;

export type WsPoolUpdatesAuthMode = 'required' | 'optional';

export interface WsAuthPolicy {
  mode: WsPoolUpdatesAuthMode;
  maxSubscriptions: number;
  anonymousMaxSubscriptions: number;
  /** Set when the configured mode was refused (for a one-off ops warning). */
  downgradeReason?: 'invalid_mode' | 'mainnet_not_enabled';
}

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWsAuthPolicy(env: Env = process.env): WsAuthPolicy {
  const maxSubscriptions = positiveInt(
    env.PRICE_WS_MAX_SUBSCRIPTIONS_PER_CLIENT,
    50,
  );
  // Anonymous clients never get more than authenticated ones.
  const anonymousMaxSubscriptions = Math.min(
    positiveInt(env.WS_POOL_UPDATES_ANON_MAX_SUBSCRIPTIONS, 10),
    maxSubscriptions,
  );
  const base = { maxSubscriptions, anonymousMaxSubscriptions };

  const raw = (env.WS_POOL_UPDATES_AUTH_MODE ?? 'required')
    .trim()
    .toLowerCase();
  if (raw !== 'required' && raw !== 'optional') {
    return { ...base, mode: 'required', downgradeReason: 'invalid_mode' };
  }
  if (
    raw === 'optional' &&
    env.STELLAR_NETWORK === 'mainnet' &&
    env.WS_POOL_UPDATES_ANON_MAINNET_ENABLED !== 'true'
  ) {
    return {
      ...base,
      mode: 'required',
      downgradeReason: 'mainnet_not_enabled',
    };
  }
  return { ...base, mode: raw };
}

export type WsPrincipal =
  { kind: 'wallet'; walletAddress: string } | { kind: 'anonymous' };

export type WsAuthResult =
  | { ok: true; principal: WsPrincipal; correlationId: string }
  | { ok: false; code: WsErrorCode; message: string; correlationId: string };

interface JwtPayload {
  sub?: unknown;
  walletAddress?: unknown;
  wallet?: unknown;
  address?: unknown;
}

function walletFrom(payload: JwtPayload): string | null {
  for (const v of [
    payload.walletAddress,
    payload.wallet,
    payload.address,
    payload.sub,
  ]) {
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * Authenticates a WebSocket handshake. The token travels as `?token=` since
 * browsers cannot set headers on a WebSocket upgrade.
 */
export function authenticateWsHandshake(
  request: IncomingMessage,
  policy: WsAuthPolicy,
  env: Env = process.env,
): WsAuthResult {
  const correlationId = resolveCorrelationId(request.headers);
  const fail = (code: WsErrorCode, message: string): WsAuthResult => ({
    ok: false,
    code,
    message,
    correlationId,
  });

  let token: string | null = null;
  try {
    token = new URL(request.url ?? '', 'http://localhost').searchParams.get(
      'token',
    );
  } catch {
    return fail(WS_ERROR_CODES.INVALID_REQUEST, 'Malformed handshake URL');
  }

  if (!token) {
    return policy.mode === 'optional'
      ? { ok: true, principal: { kind: 'anonymous' }, correlationId }
      : fail(WS_ERROR_CODES.AUTH_REQUIRED, 'Unauthorized: missing token');
  }

  const secret = env.JWT_SECRET;
  if (!secret) {
    // Cannot verify, so the presented credential is not accepted — and it is
    // not silently ignored either (no downgrade to anonymous).
    return fail(WS_ERROR_CODES.AUTH_INVALID, 'Unauthorized: invalid token');
  }

  const options: VerifyOptions = { algorithms: ['HS256'] };
  if (env.JWT_ISSUER) options.issuer = env.JWT_ISSUER;
  if (env.JWT_AUDIENCE) options.audience = env.JWT_AUDIENCE;

  try {
    const payload = verify(token, secret, options) as JwtPayload;
    const walletAddress =
      payload && typeof payload === 'object' ? walletFrom(payload) : null;
    if (!walletAddress) {
      return fail(WS_ERROR_CODES.AUTH_INVALID, 'Unauthorized: invalid token');
    }
    return {
      ok: true,
      principal: { kind: 'wallet', walletAddress },
      correlationId,
    };
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      return fail(WS_ERROR_CODES.AUTH_EXPIRED, 'Unauthorized: token expired');
    }
    if (err instanceof JsonWebTokenError) {
      return fail(WS_ERROR_CODES.AUTH_INVALID, 'Unauthorized: invalid token');
    }
    return fail(WS_ERROR_CODES.AUTH_INVALID, 'Unauthorized: invalid token');
  }
}

export type WsAction = 'subscribe' | 'unsubscribe' | 'swap';

/** Read-only actions an anonymous session may perform. */
const ANONYMOUS_ACTIONS: ReadonlySet<WsAction> = new Set([
  'subscribe',
  'unsubscribe',
]);

export function isActionAllowed(
  principal: WsPrincipal,
  action: WsAction,
): boolean {
  return principal.kind === 'wallet' || ANONYMOUS_ACTIONS.has(action);
}

export function subscriptionLimitFor(
  principal: WsPrincipal,
  policy: WsAuthPolicy,
): number {
  return principal.kind === 'wallet'
    ? policy.maxSubscriptions
    : policy.anonymousMaxSubscriptions;
}

/** Pool ids are contract ids / slugs; anything else is adversarial input. */
const POOL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidPoolId(value: unknown): value is string {
  return typeof value === 'string' && POOL_ID_PATTERN.test(value);
}

type WsAuthOutcome =
  | 'connected_wallet'
  | 'connected_anonymous'
  | 'rejected_auth_required'
  | 'rejected_auth_invalid'
  | 'rejected_auth_expired'
  | 'rejected_invalid_request'
  | 'forbidden_action'
  | 'subscription_limit';

export const wsPoolUpdatesAuthOutcomes = new BoundedCounter<WsAuthOutcome>(
  'ws_pool_updates_auth_outcomes',
  [
    'connected_wallet',
    'connected_anonymous',
    'rejected_auth_required',
    'rejected_auth_invalid',
    'rejected_auth_expired',
    'rejected_invalid_request',
    'forbidden_action',
    'subscription_limit',
  ],
);

export function recordHandshakeOutcome(result: WsAuthResult): void {
  if (result.ok) {
    wsPoolUpdatesAuthOutcomes.inc(
      result.principal.kind === 'wallet'
        ? 'connected_wallet'
        : 'connected_anonymous',
    );
    return;
  }
  const byCode: Partial<Record<WsErrorCode, WsAuthOutcome>> = {
    [WS_ERROR_CODES.AUTH_REQUIRED]: 'rejected_auth_required',
    [WS_ERROR_CODES.AUTH_INVALID]: 'rejected_auth_invalid',
    [WS_ERROR_CODES.AUTH_EXPIRED]: 'rejected_auth_expired',
    [WS_ERROR_CODES.INVALID_REQUEST]: 'rejected_invalid_request',
  };
  wsPoolUpdatesAuthOutcomes.inc(byCode[result.code] ?? 'rejected_auth_invalid');
}
