// Type declarations for scripts/fixtures.js so TypeScript consumers
// (e.g. apps/api/test/fixtures.ts) can import the validator under `strict`.

export interface FixtureError {
  code: string;
  file: string;
  message: string;
}

export const ERROR_CODES: Readonly<Record<string, string>>;

export function canonicalJson(value: unknown): string;

/**
 * Runs every fixture invariant. Read-only.
 *
 * @returns `errors` — violations found (empty when all fixtures pass).
 *          `fixtures` — the number of manifest fixture entries inspected,
 *          counted regardless of whether errors were found.
 */
export function checkFixtures(options?: { root?: string }): {
  errors: FixtureError[];
  fixtures: number;
};
/**
 * Re-canonicalises fixtures, syncs mirrors and refreshes manifest hashes.
 * Refuses under CI and refuses when non-repairable errors exist (fail-closed).
 *
 * All-or-nothing: when `errors` is non-empty, no files are written and
 * `written` is always `[]`.
 *
 * @returns `errors` — blocking (non-repairable) violations found (empty on success).
 *          `written` — files that were re-canonicalised or synced
 *          (always `[]` when `errors` is non-empty).
 */
export function writeFixtures(options?: {
  root?: string;
  env?: Record<string, string | undefined>;
}): { errors: FixtureError[]; written: string[] };
export function isValidStellarPublicKey(value: unknown): boolean;
export function parseRustTickVectors(
  source: string
): Array<{ tick: number; sqrtPriceX96: string }> | null;
export function sanitizeCorrelationId(raw: unknown): string | null;
export function resolveCorrelationId(env: Record<string, string | undefined>): string;
export function validateClMathVectors(data: unknown, file?: string): FixtureError[];
export function validateE2eSeed(data: unknown, file?: string): FixtureError[];
export function main(argv?: string[], env?: Record<string, string | undefined>): number;
