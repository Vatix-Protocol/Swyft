/**
 * Deterministic e2e fixtures (issue #1037).
 *
 * Single entrypoint for e2e specs that need seeded data. Reads the canonical
 * fixtures/e2e-seed.json (the same file prisma/seed.ts writes to the DB),
 * validates it with scripts/fixtures.js, and returns a deep-frozen copy so a
 * spec cannot mutate shared state and leak it into the next spec.
 *
 * Fail-closed: an invalid fixture throws E2E_FIXTURE_INVALID instead of letting
 * specs run against partial or drifted data.
 */
import * as fs from 'fs';
import * as path from 'path';
import { validateE2eSeed } from '../../../scripts/fixtures';
import type { E2eSeedFixture } from '../../../prisma/seed';

export type { E2eSeedFixture };

export const E2E_SEED_FILE = path.resolve(
  __dirname,
  '../../../fixtures/e2e-seed.json',
);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function loadE2eSeed(file: string = E2E_SEED_FILE): E2eSeedFixture {
  const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateE2eSeed(data, path.basename(file));
  if (errors.length > 0) {
    const detail = errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    throw new Error(`E2E_FIXTURE_INVALID: ${detail}`);
  }
  return deepFreeze(data as E2eSeedFixture);
}

/** Fixed wall clock for e2e specs, e.g. `jest.useFakeTimers({ now: e2eNow() })`. */
export function e2eNow(fixture: E2eSeedFixture = loadE2eSeed()): Date {
  return new Date(fixture.clock.now);
}

/**
 * Rows shaped like Prisma query results (ISO strings → Date), for use as
 * `findMany` mock return values so e2e responses match a seeded database.
 */
export function toPrismaRows(fixture: E2eSeedFixture = loadE2eSeed()) {
  return {
    tokens: fixture.tokens.map((t) => ({ logoUri: null, ...t })),
    pools: fixture.pools.map((p) => ({
      ...p,
      currentPrice: null,
      active: true,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.createdAt),
    })),
    positions: fixture.positions.map((p) => ({
      ...p,
      closedAt: null,
      createdAt: new Date(p.createdAt),
    })),
    swaps: fixture.swaps.map((s) => ({
      ...s,
      feeAmount: '0',
      timestamp: new Date(s.timestamp),
    })),
    priceCandles: fixture.priceCandles.map((k) => ({
      ...k,
      periodStart: new Date(k.periodStart),
    })),
  };
}
