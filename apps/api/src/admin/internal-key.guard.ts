import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { resolveCorrelationId } from '../observability/correlation-id';
import {
  InternalKeySurface,
  KeyRing,
  KeyRingMatch,
  keyRingConfigProblems,
  loadKeyRing,
  matchKeyRing,
  PLACEHOLDER_INTERNAL_API_KEY,
  recordKeyRingOutcome,
} from './internal-key-ring';

/**
 * Validate INTERNAL_API_KEY (and any in-flight key rotation) at startup
 * (called in main.ts).
 * In production, refuses to boot if the key is unset or still the
 * placeholder from .env.example — /admin, indexer replay, and /metrics
 * must never silently reject (or silently accept) every caller — or if a
 * `<NAME>_PREVIOUS` rotation window is misconfigured (#1030).
 */
export function validateInternalApiKeyConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.INTERNAL_API_KEY;
    if (!key || key === PLACEHOLDER_INTERNAL_API_KEY) {
      throw new Error(
        'Production startup failed: INTERNAL_API_KEY must be set to a ' +
          'non-default value. It protects /admin, indexer replay, and ' +
          '/metrics endpoints.',
      );
    }

    const problems = (
      ['INTERNAL_API_KEY', 'FEE_COLLECTOR_AUTH', 'TESTNET_REDEPLOY_AUTH'] as const
    ).flatMap((name) => keyRingConfigProblems(loadKeyRing(name)));
    if (problems.length > 0) {
      throw new Error(
        `Production startup failed: invalid key rotation config: ${problems.join('; ')}`,
      );
    }
  }
}

const previousSlotWarned = new Set<KeyRing['name']>();

/**
 * Checks the presented `x-internal-key` against a key ring, records the
 * outcome metric, and logs slot/denial reason (never key material).
 */
function checkKeyRing(
  req: Request,
  ring: KeyRing,
  surface: InternalKeySurface,
  correlationId: string,
  logger: Logger,
): KeyRingMatch {
  const match = matchKeyRing(req.headers['x-internal-key'], ring);
  recordKeyRingOutcome(surface, match);
  if (!match.ok) {
    logger.warn(
      `[${correlationId}] ${surface} internal-key denied reason=${match.reason}`,
    );
  } else if (match.slot === 'previous' && !previousSlotWarned.has(ring.name)) {
    // Once per ring per process; the metric carries the ongoing count.
    previousSlotWarned.add(ring.name);
    logger.warn(
      `[${correlationId}] ${surface} authenticated with ${ring.name}_PREVIOUS; ` +
        'finish rotating callers before the window expires',
    );
  }
  return match;
}

/**
 * Stable error codes for the fee-collector auth surface (#965).
 * Deny-by-default: any failure to prove FEE_COLLECTOR_AUTH is rejected.
 */
export const FEE_COLLECTOR_AUTH_ERRORS = {
  MISSING_KEY: 'FEE_COLLECTOR_AUTH_MISSING_KEY',
  INVALID_KEY: 'FEE_COLLECTOR_AUTH_INVALID_KEY',
  WRONG_ROLE: 'FEE_COLLECTOR_AUTH_WRONG_ROLE',
  EXPIRED: 'FEE_COLLECTOR_AUTH_EXPIRED',
  NOT_CONFIGURED: 'FEE_COLLECTOR_AUTH_NOT_CONFIGURED',
} as const;

export type FeeCollectorAuthErrorCode =
  (typeof FEE_COLLECTOR_AUTH_ERRORS)[keyof typeof FEE_COLLECTOR_AUTH_ERRORS];

/**
 * Stable error codes for the testnet wasm-hash redeploy surface (#969).
 * Deny-by-default: any failure to prove the redeploy role is rejected.
 */
export const TESTNET_REDEPLOY_AUTH_ERRORS = {
  MISSING_KEY: 'TESTNET_REDEPLOY_AUTH_MISSING_KEY',
  INVALID_KEY: 'TESTNET_REDEPLOY_AUTH_INVALID_KEY',
  WRONG_ROLE: 'TESTNET_REDEPLOY_AUTH_WRONG_ROLE',
  EXPIRED: 'TESTNET_REDEPLOY_AUTH_EXPIRED',
  NOT_CONFIGURED: 'TESTNET_REDEPLOY_AUTH_NOT_CONFIGURED',
  MAINNET_FORBIDDEN: 'TESTNET_REDEPLOY_AUTH_MAINNET_FORBIDDEN',
} as const;

export type TestnetRedeployAuthErrorCode =
  (typeof TESTNET_REDEPLOY_AUTH_ERRORS)[keyof typeof TESTNET_REDEPLOY_AUTH_ERRORS];

/**
 * Stable error codes for the factory fee-tier allowlist surface (#1022).
 * Deny-by-default: any failure to prove the fee-tier admin role is rejected.
 */
export const FACTORY_FEE_TIER_AUTH_ERRORS = {
  MISSING_KEY: 'FACTORY_FEE_TIER_AUTH_MISSING_KEY',
  INVALID_KEY: 'FACTORY_FEE_TIER_AUTH_INVALID_KEY',
  WRONG_ROLE: 'FACTORY_FEE_TIER_AUTH_WRONG_ROLE',
  EXPIRED: 'FACTORY_FEE_TIER_AUTH_EXPIRED',
  NOT_CONFIGURED: 'FACTORY_FEE_TIER_AUTH_NOT_CONFIGURED',
  DISABLED: 'FACTORY_FEE_TIER_AUTH_DISABLED',
} as const;

export type FactoryFeeTierAuthErrorCode =
  (typeof FACTORY_FEE_TIER_AUTH_ERRORS)[keyof typeof FACTORY_FEE_TIER_AUTH_ERRORS];

/**
 * Stable error codes for the pool-initialize auth surface (#1023).
 * Deny-by-default: any failure to prove the pool-init admin role is rejected,
 * so a frontrunner cannot race `initialize` to steal pool admin.
 */
export const POOL_INIT_AUTH_ERRORS = {
  MISSING_KEY: 'POOL_INIT_AUTH_MISSING_KEY',
  INVALID_KEY: 'POOL_INIT_AUTH_INVALID_KEY',
  WRONG_ROLE: 'POOL_INIT_AUTH_WRONG_ROLE',
  EXPIRED: 'POOL_INIT_AUTH_EXPIRED',
  NOT_CONFIGURED: 'POOL_INIT_AUTH_NOT_CONFIGURED',
  ALREADY_INITIALIZED: 'POOL_INIT_AUTH_ALREADY_INITIALIZED',
  REPLAY_DETECTED: 'POOL_INIT_AUTH_REPLAY_DETECTED',
  DEPENDENCY_UNAVAILABLE: 'POOL_INIT_AUTH_DEPENDENCY_UNAVAILABLE',
} as const;

export type PoolInitAuthErrorCode =
  (typeof POOL_INIT_AUTH_ERRORS)[keyof typeof POOL_INIT_AUTH_ERRORS];

/**
 * Constant-time comparison that never throws on length mismatch.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Guard enforcing FEE_COLLECTOR_AUTH for fee-collector entrypoints.
 *
 * Invariants:
 *  - Deny-by-default: missing/expired/wrong-role credentials are rejected.
 *  - Fail-closed: if the expected key is not configured, all requests are denied.
 *  - Rotation (#1030): the `_PREVIOUS` key is honoured only until its
 *    `_PREVIOUS_EXPIRES_AT`; afterwards it is rejected with the EXPIRED code.
 *  - No bypass: untrusted clients cannot satisfy the check without the key.
 *  - Correlation id is su
 * Guard enforcing FEE_COLLECTOR_AUTH for fee-collector entrypoints.
 *
 * Invariants:
 *  - Deny-by-default: missing/expired/wrong-role credentials are rejected.
 *  - Fail-closed: if the expected key is not configured, all requests are denied.
 *  - Rotation (#1030): the `_PREVIOUS` key is honoured only until its
 *    `_PREVIOUS_EXPIRES_AT`; afterwards it is rejected with the EXPIRED code.
 *  - No bypass: untrusted clients cannot satisfy the check without the key.
 *  - Correlation id is surfaced for ops without leaking the secret.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const correlationId = resolveCorrelationId(req.headers);

    // FEE_COLLECTOR_AUTH takes precedence whenever it is defined (an empty
    // value fails closed rather than falling back); otherwise the shared
    // INTERNAL_API_KEY ring (with its own rotation slot) is used.
    const ring = loadKeyRing(
      process.env.FEE_COLLECTOR_AUTH !== undefined
        ? 'FEE_COLLECTOR_AUTH'
        : 'INTERNAL_API_KEY',
    );
    const match = checkKeyRing(
      req,
      ring,
      'fee_collector',
      correlationId,
      this.logger,
    );
    if (!match.ok) {
      const [code, message] = {
        // Fail-closed: no configured secret means no privileged access.
        not_configured: [
          FEE_COLLECTOR_AUTH_ERRORS.NOT_CONFIGURED,
          'Fee collector auth is not configured',
        ],
        missing: [
          FEE_COLLECTOR_AUTH_ERRORS.MISSING_KEY,
          'Missing fee collector credentials',
        ],
        invalid: [
          FEE_COLLECTOR_AUTH_ERRORS.INVALID_KEY,
          'Invalid fee collector credentials',
        ],
        previous_expired: [
          FEE_COLLECTOR_AUTH_ERRORS.EXPIRED,
          'Fee collector credentials expired',
        ],
      }[match.reason];
      throw new UnauthorizedException({ code, message, correlationId });
    }

    // Optional role/expiry enforcement when the caller presents a scoped token.
    const role = req.headers['x-fee-collector-role'] as string | undefined;
    if (role && role !== 'fee-collector') {
      throw new ForbiddenException({
        code: FEE_COLLECTOR_AUTH_ERRORS.WRONG_ROLE,
        message: 'Caller lacks fee-collector role',
        correlationId,
      });
    }

    const expiresAt = req.headers['x-fee-collector-expires-at'] as string | undefined;
    if (expiresAt) {
      const ts = Number(expiresAt);
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        throw new UnauthorizedException({
          code: FEE_COLLECTOR_AUTH_ERRORS.EXPIRED,
          message: 'Fee collector credentials expired',
          correlationId,
        });
      }
    }

    return true;
  }
}

/**
 * Guard enforcing TESTNET_REDEPLOY_AUTH for testnet wasm-hash redeploy
 * entrypoints (#969).
 *
 * Invariants:
 *  - Deny-by-default: missing/expired/wrong-role credentials are rejected.
 *  - Fail-closed: if the expected key is not configured, all requests are denied.
 *  - Testnet-only: mainnet redeploys are refused outright (no mainnet drift).
 *  - No bypass: untrusted clients cannot satisfy the check without the key.
 *  - Correlation id is surfaced for ops without leaking the secret.
 */
@Injectable()
export class TestnetRedeployGuard implements CanActivate {
  private readonly logger = new Logger(TestnetRedeployGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const correlationId = resolveCorrelationId(req.headers);

    // Testnet-vs-mainnet separation: never allow a mainnet redeploy here.
    const network =
      (req.headers['x-stellar-network'] as string | undefined) ??
      (req.body?.network as string | undefined);
    if (network && network !== 'testnet') {
      throw new ForbiddenException({
        code: TESTNET_REDEPLOY_AUTH_ERRORS.MAINNET_FORBIDDEN,
        message: 'Wasm-hash redeploy is restricted to testnet',
        correlationId,
      });
    }

    const match = checkKeyRing(
      req,
      loadKeyRing('TESTNET_REDEPLOY_AUTH'),
      'testnet_redeploy',
      correlationId,
      this.logger,
    );
    if (!match.ok) {
      const [code, message] = {
        // Fail-closed: no configured secret means no privileged access.
        not_configured: [
          TESTNET_REDEPLOY_AUTH_ERRORS.NOT_CONFIGURED,
          'Testnet redeploy auth is not configured',
        ],
        missing: [
          TESTNET_REDEPLOY_AUTH_ERRORS.MISSING_KEY,
          'Missing testnet redeploy credentials',
        ],
        invalid: [
          TESTNET_REDEPLOY_AUTH_ERRORS.INVALID_KEY,
          'Invalid testnet redeploy credentials',
        ],
        previous_expired: [
          TESTNET_REDEPLOY_AUTH_ERRORS.EXPIRED,
          'Testnet redeploy credentials expired',
        ],
      }[match.reason];
      throw new UnauthorizedException({ code, message, correlationId });
    }

    // Optional role/expiry enforcement when the caller presents a scoped token.
    const role = req.headers['x-testnet-redeploy-role'] as string | undefined;
    if (role && role !== 'testnet-redeployer') {
      throw new ForbiddenException({
        code: TESTNET_REDEPLOY_AUTH_ERRORS.WRONG_ROLE,
        message: 'Caller lacks testnet-redeployer role',
        correlationId,
      });
    }

    const expiresAt = req.headers['x-testnet-redeploy-expires-at'] as string | undefined;
    if (expiresAt) {
      const ts = Number(expiresAt);
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        throw new UnauthorizedException({
          code: TESTNET_REDEPLOY_AUTH_ERRORS.EXPIRED,
          message: 'Testnet redeploy credentials expired',
          correlationId,
        });
      }
    }

    return true;
  }
}

/**
 * Guard enforcing POOL_INIT_AUTH for pool `initialize` entrypoints (#1023).
 *
 * Invariants:
 *  - Deny-by-default: missing/expired/wrong-role credentials are rejected, so
 *    an untrusted frontrunner cannot race `initialize` to become pool admin.
 *  - Fail-closed: if the expected key is not configured, all requests are denied.
 *  - Idempotent/replay-safe: a per-pool init nonce is required and single-use;
 *    concurrent or replayed initialize requests fail closed.
 *  - Dependency fail-closed: if the replay store (Redis/DB) is unavailable the
 *    write path is refused rather than allowed through.
 *  - No bypass: untrusted clients cannot satisfy the check without the key.
 *  - Correlation id is surfaced for ops without leaking the secret.
 */
@Injectable()
export class PoolInitGuard implements CanActivate {
  private readonly logger = new Logger(PoolInitGuard.name);

  /**
   * Single-use nonce store for pool-init replay protection. Injected/overridable
   * so tests and ops can supply a Redis/DB-backed implementation. When unset,
   * the guard fails closed (no privileged init without a replay store).
   */
  constructor(
    private readonly replayStore?: {
      /** Atomically claim a nonce; returns false if already used. */
      claim(key: string): Promise<boolean>;
    },
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined) ??
      'unknown';

    const expected = process.env.POOL_INIT_AUTH;
    if (!expected) {
      // Fail-closed: no configured secret means no privileged access.
      throw new UnauthorizedException({
        code: POOL_INIT_AUTH_ERRORS.NOT_CONFIGURED,
        message: 'Pool init auth is not configured',
        correlationId,
      });
    }

    const key = req.headers['x-internal-key'] as string | undefined;
    if (!key) {
      throw new UnauthorizedException({
        code: POOL_INIT_AUTH_ERRORS.MISSING_KEY,
        message: 'Missing pool init credentials',
        correlationId,
      });
    }

    if (!safeEqual(key, expected)) {
      throw new UnauthorizedException({
        code: POOL_INIT_AUTH_ERRORS.INVALID_KEY,
        message: 'Invalid pool init credentials',
        correlationId,
      });
    }

    // Optional role/expiry enforcement when the caller presents a scoped token.
    const role = req.headers['x-pool-init-role'] as string | undefined;
    if (role && role !== 'pool-init-admin') {
      throw new ForbiddenException({
        code: POOL_INIT_AUTH_ERRORS.WRONG_ROLE,
        message: 'Caller lacks pool-init-admin role',
        correlationId,
      });
    }

    const expiresAt = req.headers['x-pool-init-expires-at'] as string | undefined;
    if (expiresAt) {
      const ts = Number(expiresAt);
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        throw new UnauthorizedException({
          code: POOL_INIT_AUTH_ERRORS.EXPIRED,
          message: 'Pool init credentials expired',
          correlationId,
        });
      }
    }

    // Idempotency/replay protection: require a single-use init nonce per pool.
    const poolId =
      (req.headers['x-pool-id'] as string | undefined) ??
      (req.body?.poolId as string | undefined);
    const nonce = req.headers['x-pool-init-nonce'] as string | undefined;
    if (!poolId || !nonce) {
      throw new ForbiddenException({
        code: POOL_INIT_AUTH_ERRORS.REPLAY_DETECTED,
        message: 'Pool init requires a pool id and single-use nonce',
        correlationId,
      });
    }

    if (!this.replayStore) {
      // Fail-closed: without a replay store we cannot guarantee single-use.
      throw new UnauthorizedException({
        code: POOL_INIT_AUTH_ERRORS.DEPENDENCY_UNAVAILABLE,
        message: 'Pool init replay store is unavailable',
        correlationId,
      });
    }

    let claimed: boolean;
    try {
      claimed = await this.replayStore.claim(`pool-init:${poolId}:${nonce}`);
    } catch (err) {
      // Dependency outage (Redis/DB): fail closed on the init write path.
      this.logger.error(
        `Pool init replay store error (correlationId=${correlationId}): ${
          (err as Error)?.message ?? 'unknown'
        }`,
      );
      throw new UnauthorizedException({
        code: POOL_INIT_AUTH_ERRORS.DEPENDENCY_UNAVAILABLE,
        message: 'Pool init replay store is unavailable',
        correlationId,
      });
    }

    if (!claimed) {
      // Concurrent or replayed initialize request: reject, do not re-init.
      throw new ForbiddenException({
        code: POOL_INIT_AUTH_ERRORS.REPLAY_DETECTED,
        message: 'Pool init nonce already used',
        correlationId,
      });
    }

    return true;
  }
}
