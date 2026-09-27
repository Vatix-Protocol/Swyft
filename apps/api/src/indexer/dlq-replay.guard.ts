import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { resolveCorrelationId } from '../observability/correlation-id';
import { BoundedCounter } from '../observability/bounded-counter';
import {
  KeyRingDenial,
  loadKeyRing,
  matchKeyRing,
  recordKeyRingOutcome,
} from '../admin/internal-key-ring';

/**
 * Stable error codes for `POST /indexer/dead-letters/replay` (#1026).
 * Part of the public contract — do not rename without a migration.
 */
export const DLQ_REPLAY_AUTH_ERRORS = {
  MISSING_KEY: 'DLQ_REPLAY_AUTH_MISSING_KEY',
  INVALID_KEY: 'DLQ_REPLAY_AUTH_INVALID_KEY',
  EXPIRED: 'DLQ_REPLAY_AUTH_EXPIRED',
  NOT_CONFIGURED: 'DLQ_REPLAY_AUTH_NOT_CONFIGURED',
  WRONG_ROLE: 'DLQ_REPLAY_AUTH_WRONG_ROLE',
  DISABLED: 'DLQ_REPLAY_AUTH_DISABLED',
  MAINNET_DISABLED: 'DLQ_REPLAY_AUTH_MAINNET_DISABLED',
  RATE_LIMITED: 'DLQ_REPLAY_AUTH_RATE_LIMITED',
} as const;

export type DlqReplayAuthErrorCode =
  (typeof DLQ_REPLAY_AUTH_ERRORS)[keyof typeof DLQ_REPLAY_AUTH_ERRORS];

export const DLQ_REPLAY_ROLE = 'indexer-operator';

type Env = Record<string, string | undefined>;

export interface DlqReplayPolicy {
  /** Kill switch: replay is refused unless explicitly enabled. */
  enabled: boolean;
  /** On mainnet, replay needs a second, mainnet-specific opt-in. */
  mainnet: boolean;
  mainnetEnabled: boolean;
  /** Max authorised replay requests per window (per process). */
  maxPerWindow: number;
  windowMs: number;
}

export function resolveDlqReplayPolicy(
  env: Env = process.env,
): DlqReplayPolicy {
  const max = Number(env.INDEXER_DLQ_REPLAY_MAX_PER_MINUTE);
  return {
    enabled: env.INDEXER_DLQ_REPLAY_ENABLED === 'true',
    mainnet: env.STELLAR_NETWORK === 'mainnet',
    mainnetEnabled: env.INDEXER_DLQ_REPLAY_MAINNET_ENABLED === 'true',
    maxPerWindow: Number.isInteger(max) && max > 0 && max <= 1000 ? max : 10,
    windowMs: 60_000,
  };
}

/**
 * Fixed-window limiter. A single shared bucket: the surface is operator-only
 * and callers share one key, so per-caller buckets would add nothing.
 */
export class FixedWindowLimiter {
  private windowStart = 0;
  private count = 0;

  /** Returns 0 when allowed, otherwise ms until the window resets. */
  take(max: number, windowMs: number, now: number = Date.now()): number {
    if (now - this.windowStart >= windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count >= max) return this.windowStart + windowMs - now;
    this.count += 1;
    return 0;
  }

  reset(): void {
    this.windowStart = 0;
    this.count = 0;
  }
}

export const dlqReplayRateLimiter = new FixedWindowLimiter();

type Outcome =
  | 'allowed'
  | 'not_configured'
  | 'missing'
  | 'invalid'
  | 'previous_expired'
  | 'wrong_role'
  | 'expired'
  | 'disabled'
  | 'mainnet_disabled'
  | 'rate_limited';

export const dlqReplayAuthOutcomes = new BoundedCounter<Outcome>(
  'indexer_dlq_replay_auth_outcomes',
  [
    'allowed',
    'not_configured',
    'missing',
    'invalid',
    'previous_expired',
    'wrong_role',
    'expired',
    'disabled',
    'mainnet_disabled',
    'rate_limited',
  ],
);

const KEY_DENIALS: Record<KeyRingDenial, [DlqReplayAuthErrorCode, string]> = {
  not_configured: [
    DLQ_REPLAY_AUTH_ERRORS.NOT_CONFIGURED,
    'Dead-letter replay auth is not configured',
  ],
  missing: [
    DLQ_REPLAY_AUTH_ERRORS.MISSING_KEY,
    'Missing dead-letter replay credentials',
  ],
  invalid: [
    DLQ_REPLAY_AUTH_ERRORS.INVALID_KEY,
    'Invalid dead-letter replay credentials',
  ],
  previous_expired: [
    DLQ_REPLAY_AUTH_ERRORS.EXPIRED,
    'Dead-letter replay credentials expired',
  ],
};

/** Correlation id resolved by the guard, reused by the handler. */
export function requestCorrelationId(req: Request): string {
  const stored = (req as Request & { correlationId?: string }).correlationId;
  return stored ?? resolveCorrelationId(req.headers);
}

/**
 * Guards the dead-letter replay endpoint (#1026).
 *
 * Replay re-enqueues pool/swap/position projections, so this is a money-path
 * write surface. Invariants:
 *  - Deny-by-default: authenticates against the INTERNAL_API_KEY ring only.
 *    Other shared secrets (FEE_COLLECTOR_AUTH etc.) never grant replay.
 *  - Checks run in order auth → role/expiry → kill switch → network →
 *    rate limit, so unauthenticated callers always get 401 and learn
 *    nothing about flag state.
 *  - Kill switch: `INDEXER_DLQ_REPLAY_ENABLED=true` is required; mainnet also
 *    requires `INDEXER_DLQ_REPLAY_MAINNET_ENABLED=true`.
 *  - Every rejection carries a stable code and correlation id; logs and
 *    metrics record the reason, never key material.
 */
@Injectable()
export class DlqReplayGuard implements CanActivate {
  private readonly logger = new Logger(DlqReplayGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const correlationId = resolveCorrelationId(req.headers);
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    const policy = resolveDlqReplayPolicy();

    const deny = (outcome: Outcome, exception: HttpException): never => {
      dlqReplayAuthOutcomes.inc(outcome);
      this.logger.warn(
        `[${correlationId}] dlq replay denied reason=${outcome}`,
      );
      throw exception;
    };

    const match = matchKeyRing(
      req.headers['x-internal-key'],
      loadKeyRing('INTERNAL_API_KEY'),
    );
    recordKeyRingOutcome('dlq_replay', match);
    if (!match.ok) {
      const [code, message] = KEY_DENIALS[match.reason];
      deny(
        match.reason,
        new UnauthorizedException({ code, message, correlationId }),
      );
    }

    const role = req.headers['x-dlq-replay-role'];
    if (role !== undefined && role !== DLQ_REPLAY_ROLE) {
      deny(
        'wrong_role',
        new ForbiddenException({
          code: DLQ_REPLAY_AUTH_ERRORS.WRONG_ROLE,
          message: `Caller lacks ${DLQ_REPLAY_ROLE} role`,
          correlationId,
        }),
      );
    }

    const expiresAt = req.headers['x-dlq-replay-expires-at'];
    if (expiresAt !== undefined) {
      const ts = Number(expiresAt);
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        deny(
          'expired',
          new UnauthorizedException({
            code: DLQ_REPLAY_AUTH_ERRORS.EXPIRED,
            message: 'Dead-letter replay credentials expired',
            correlationId,
          }),
        );
      }
    }

    if (!policy.enabled) {
      deny(
        'disabled',
        new ForbiddenException({
          code: DLQ_REPLAY_AUTH_ERRORS.DISABLED,
          message:
            'Dead-letter replay is disabled (INDEXER_DLQ_REPLAY_ENABLED)',
          correlationId,
        }),
      );
    }

    if (policy.mainnet && !policy.mainnetEnabled) {
      deny(
        'mainnet_disabled',
        new ForbiddenException({
          code: DLQ_REPLAY_AUTH_ERRORS.MAINNET_DISABLED,
          message:
            'Dead-letter replay on mainnet requires INDEXER_DLQ_REPLAY_MAINNET_ENABLED',
          correlationId,
        }),
      );
    }

    const retryAfterMs = dlqReplayRateLimiter.take(
      policy.maxPerWindow,
      policy.windowMs,
    );
    if (retryAfterMs > 0) {
      deny(
        'rate_limited',
        new HttpException(
          {
            code: DLQ_REPLAY_AUTH_ERRORS.RATE_LIMITED,
            message: 'Too many dead-letter replay requests',
            retryAfterMs,
            correlationId,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
    }

    dlqReplayAuthOutcomes.inc('allowed');
    this.logger.log(
      `[${correlationId}] dlq replay authorised slot=${match.ok ? match.slot : 'none'}`,
    );
    return true;
  }
}
