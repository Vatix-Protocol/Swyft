// Type declarations for scripts/fixtures.js so TypeScript consumers
// (e.g. apps/api/test/fixtures.ts) can import the validator under `strict`.

export interface FixtureError {
  code: string;
  file: string;
  message: string;
}

export const ERROR_CODES: Readonly<Record<string, string>>;

export function canonicalJson(value: unknown): string;
export function checkFixtures(options?: { root?: string }): {
  errors: FixtureError[];
  fixtures: number;
};
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
