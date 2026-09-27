/**
 * Contract tests for the deterministic e2e fixture set (issue #1037).
 *
 * Deliberately independent of AppModule so fixture guarantees are verified
 * even when unrelated modules fail to bootstrap.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { E2E_SEED_FILE, e2eNow, loadE2eSeed, toPrismaRows } from './fixtures';

/** Mutable, loosely-typed view of the seed for building invalid variants. */
interface LooseSeed {
  network: string;
  pools: Array<Record<string, unknown>>;
  positions: Array<Record<string, unknown>>;
  swaps: Array<Record<string, unknown>>;
}

describe('e2e fixtures (deterministic)', () => {
  it('loads the canonical seed and passes the fixture validator', () => {
    const fixture = loadE2eSeed();
    expect(fixture.network).toBe('testnet');
    expect(fixture.pools.map((p) => p.id)).toEqual(['test-pool-1']);
    expect(fixture.swaps.map((s) => s.eventId)).toEqual([
      'seed-swap-event-1',
      'seed-swap-event-2',
    ]);
  });

  it('is byte-for-byte stable across loads', () => {
    expect(JSON.stringify(loadE2eSeed())).toBe(JSON.stringify(loadE2eSeed()));
  });

  it('is deep-frozen so specs cannot leak mutations into each other', () => {
    const fixture = loadE2eSeed();
    expect(() => {
      (fixture.pools[0] as { tvl: string }).tvl = '0';
    }).toThrow(TypeError);
    expect(loadE2eSeed().pools[0].tvl).toBe('2000000000');
  });

  it('exposes a fixed clock instead of the wall clock', () => {
    expect(e2eNow().toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('maps to Prisma-shaped rows with pinned Date values', () => {
    const rows = toPrismaRows();
    expect(rows.swaps[0].timestamp).toEqual(
      new Date('2026-01-01T00:05:00.000Z'),
    );
    expect(rows.pools[0].createdAt).toEqual(
      new Date('2026-01-01T00:00:00.000Z'),
    );
    // Money amounts stay integer strings (no float precision loss).
    expect(rows.pools[0].liquidity).toBe('1000000000000000000');
  });

  describe('fail-closed on bad fixtures', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-e2e-fixture-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    function writeVariant(mutate: (seed: LooseSeed) => void) {
      const seed = JSON.parse(
        fs.readFileSync(E2E_SEED_FILE, 'utf8'),
      ) as LooseSeed;
      mutate(seed);
      const file = path.join(dir, 'e2e-seed.json');
      fs.writeFileSync(file, JSON.stringify(seed));
      return file;
    }

    it.each<[string, (seed: LooseSeed) => void, string]>([
      [
        'mainnet network',
        (s) => (s.network = 'mainnet'),
        'FIXTURE_NETWORK_NOT_TESTNET',
      ],
      [
        'wall-clock timestamp',
        (s) => (s.swaps[0].timestamp = 'now'),
        'FIXTURE_NONDETERMINISTIC_TIME',
      ],
      [
        'float money amount',
        (s) => (s.pools[0].liquidity = 1e18),
        'FIXTURE_SCHEMA_VIOLATION',
      ],
      [
        'replayed swap eventId',
        (s) => {
          s.swaps.push({ ...s.swaps[0] });
        },
        'FIXTURE_DUPLICATE_KEY',
      ],
      [
        'dangling pool reference',
        (s) => (s.positions[0].poolId = 'missing-pool'),
        'FIXTURE_DANGLING_REF',
      ],
      [
        'bad address checksum',
        (s) =>
          (s.swaps[0].senderAddress =
            'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JA'),
        'FIXTURE_INVALID_ADDRESS',
      ],
    ])('rejects %s', (_label, mutate, code) => {
      expect(() => loadE2eSeed(writeVariant(mutate))).toThrow(
        new RegExp(`E2E_FIXTURE_INVALID: .*\\[${code}\\]`),
      );
    });
  });
});
