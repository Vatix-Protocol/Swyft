import { createHash, timingSafeEqual } from 'crypto';
import { BoundedCounter } from '../observability/bounded-counter';

/**
 * Internal admin key rotation (#1030).
 *
 * Every shared-secret surface (INTERNAL_API_KEY, FEE_COLLECTOR_AUTH,
 * TESTNET_REDEPLOY_AUTH) is a key ring of at most two slots:
 *
 *   <NAME>                     current key (required for any access)
 *   <NAME>_PREVIOUS            old key, accepted only during a rotation window
 *   <NAME>_PREVIOUS_EXPIRES_AT ISO-8601 end of that window
 *
 * Invariants:
 *  - Fail-closed: no current key means no access, even if a previous key is
 *    set. A previous key without a valid, future expiry is never accepted,
 *    so a rotation window cannot be left open by accident.
 *  - Constant time: both slots are always compared, on SHA-256 digests, so
 *    neither key length nor which slot matched leaks through timing.
 *  - No secrets in logs/metrics/rate-limit buckets: callers only ever see the
 *    slot name (`current` / `previous`).
 *
 * Runbook: docs/INTERNAL_KEY_ROTATION.md.
 */
export type KeyRingName =
  'INTERNAL_API_KEY' | 'FEE_COLLECTOR_AUTH' | 'TESTNET_REDEPLOY_AUTH';

export type KeySlot = 'current' | 'previous';

export type KeyRingDenial =
  'not_configured' | 'missing' | 'invalid' | 'previous_expired';

export type KeyRingMatch =
  { ok: true; slot: KeySlot } | { ok: false; reason: KeyRingDenial };

export interface KeyRing {
  name: KeyRingName;
  current?: string;
  previous?: string;
  /** Epoch ms; undefined when unset or unparseable. */
  previousExpiresAt?: number;
}

/** Upper bound on a rotation window, enforced at production boot. */
export const MAX_ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const PLACEHOLDER_INTERNAL_API_KEY = 'change-me-in-production';

type Env = Record<string, string | undefined>;

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function loadKeyRing(
  name: KeyRingName,
  env: Env = process.env,
): KeyRing {
  const expiresRaw = nonEmpty(env[`${name}_PREVIOUS_EXPIRES_AT`]);
  const expiresAt = expiresRaw ? Date.parse(expiresRaw) : NaN;
  return {
    name,
    current: nonEmpty(env[name]),
    previous: nonEmpty(env[`${name}_PREVIOUS`]),
    previousExpiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function matchKeyRing(
  presented: unknown,
  ring: KeyRing,
  now: number = Date.now(),
): KeyRingMatch {
  if (!ring.current) {
    return { ok: false, reason: 'not_configured' };
  }
  if (typeof presented !== 'string' || presented.length === 0) {
    return { ok: false, reason: 'missing' };
  }

  const presentedDigest = digest(presented);
  const currentMatch = timingSafeEqual(presentedDigest, digest(ring.current));
  // Always compare against the previous slot too (or a dummy) so timing does
  // not reveal whether a rotation window is open.
  const previousMatch = timingSafeEqual(
    presentedDigest,
    digest(ring.previous ?? ring.current + '\u0000'),
  );

  if (currentMatch) {
    return { ok: true, slot: 'current' };
  }
  if (ring.previous && previousMatch) {
    if (ring.previousExpiresAt !== undefined && ring.previousExpiresAt > now) {
      return { ok: true, slot: 'previous' };
    }
    return { ok: false, reason: 'previous_expired' };
  }
  return { ok: false, reason: 'invalid' };
}

/**
 * Validates a ring's rotation settings. Returns human-readable problems
 * (never including key material); empty means valid.
 */
export function keyRingConfigProblems(
  ring: KeyRing,
  env: Env = process.env,
  now: number = Date.now(),
): string[] {
  const problems: string[] = [];
  const expiresRaw = nonEmpty(env[`${ring.name}_PREVIOUS_EXPIRES_AT`]);

  if (ring.previous) {
    if (!ring.current) {
      problems.push(`${ring.name}_PREVIOUS is set but ${ring.name} is not`);
    }
    if (ring.previous === ring.current) {
      problems.push(`${ring.name}_PREVIOUS must differ from ${ring.name}`);
    }
    if (ring.previous === PLACEHOLDER_INTERNAL_API_KEY) {
      problems.push(`${ring.name}_PREVIOUS must not be the placeholder value`);
    }
    if (ring.previousExpiresAt === undefined) {
      problems.push(
        `${ring.name}_PREVIOUS_EXPIRES_AT must be a valid ISO-8601 timestamp`,
      );
    } else if (ring.previousExpiresAt - now > MAX_ROTATION_WINDOW_MS) {
      problems.push(
        `${ring.name}_PREVIOUS_EXPIRES_AT must be within 7 days of boot`,
      );
    }
  } else if (expiresRaw) {
    problems.push(
      `${ring.name}_PREVIOUS_EXPIRES_AT is set but ${ring.name}_PREVIOUS is not`,
    );
  }
  return problems;
}

/**
 * Auth outcome counter per surface. Both label dimensions are fixed enums.
 */
export type InternalKeySurface =
  'fee_collector' | 'testnet_redeploy' | 'metrics' | 'dlq_replay';

type OutcomeLabel = `${InternalKeySurface}:${KeySlot | KeyRingDenial}`;

const SURFACES: InternalKeySurface[] = [
  'fee_collector',
  'testnet_redeploy',
  'metrics',
  'dlq_replay',
];
const OUTCOMES: (KeySlot | KeyRingDenial)[] = [
  'current',
  'previous',
  'not_configured',
  'missing',
  'invalid',
  'previous_expired',
];

export const internalKeyAuthOutcomes = new BoundedCounter<OutcomeLabel>(
  'internal_key_auth_outcomes',
  SURFACES.flatMap((s) => OUTCOMES.map((o) => `${s}:${o}` as OutcomeLabel)),
);

export function recordKeyRingOutcome(
  surface: InternalKeySurface,
  match: KeyRingMatch,
): void {
  internalKeyAuthOutcomes.inc(
    `${surface}:${match.ok ? match.slot : match.reason}`,
  );
}
