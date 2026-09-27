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
