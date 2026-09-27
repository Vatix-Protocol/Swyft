/**
 * Tests for scripts/fixtures.js (issue #1037).
 * Run: pnpm test:scripts   (node --test, no extra dependencies)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');

const fixtures = require('../fixtures');

const { ERROR_CODES } = fixtures;
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIRROR_FILES = [
  'packages/sdk/src/__tests__/fixtures/cl-math-vectors.json',
  'packages/contract/fixtures/cl-math-vectors.json',
];
const CL_POOL_LIB = 'packages/contract/contracts/cl-pool/src/lib.rs';

function codes(result) {
  return result.errors.map((e) => e.code);
}

/** Copies just the files the checker reads into a throwaway repo root. */
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-fixtures-'));
  const copy = (rel) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(root, rel));
  };
  for (const name of fs.readdirSync(path.join(REPO_ROOT, 'fixtures'))) {
    copy(`fixtures/${name}`);
  }
  MIRROR_FILES.forEach(copy);
  copy(CL_POOL_LIB);
  return root;
}

function editJson(root, rel, mutate) {
  const file = path.join(root, rel);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(data);
  fs.writeFileSync(file, fixtures.canonicalJson(data));
}

describe('checkFixtures on the real repo', () => {
  it('passes with no errors', () => {
    const result = fixtures.checkFixtures({ root: REPO_ROOT });
    assert.deepEqual(result.errors, []);
    assert.ok(result.fixtures >= 2);
  });
});

describe('checkFixtures invariants', () => {
  let root;
  beforeEach(() => {
    root = makeSandbox();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects unregistered fixtures (deny-by-default)', () => {
    fs.writeFileSync(path.join(root, 'fixtures/rogue.json'), '{}\n');
    assert.ok(codes(fixtures.checkFixtures({ root })).includes(ERROR_CODES.UNREGISTERED));
  });

  it('flags content edits that skip the manifest hash, and --write repairs them', () => {
    editJson(root, 'fixtures/e2e-seed.json', (s) => {
      s.pools[0].tvl = '3000000000';
    });
    assert.deepEqual(codes(fixtures.checkFixtures({ root })), [ERROR_CODES.HASH_MISMATCH]);

    const written = fixtures.writeFixtures({ root, env: {} });
    assert.deepEqual(written.errors, []);
    assert.deepEqual(written.written, ['fixtures/manifest.json']);
    assert.deepEqual(fixtures.checkFixtures({ root }).errors, []);
  });

  it('flags mirror drift and --write re-syncs the mirror', () => {
    fs.writeFileSync(path.join(root, MIRROR_FILES[0]), '{}\n');
    assert.deepEqual(codes(fixtures.checkFixtures({ root })), [ERROR_CODES.MIRROR_DRIFT]);
    fixtures.writeFixtures({ root, env: {} });
    assert.deepEqual(fixtures.checkFixtures({ root }).errors, []);
  });

  it('flags non-canonical formatting', () => {
    const file = path.join(root, 'fixtures/e2e-seed.json');
    fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))));
    assert.ok(codes(fixtures.checkFixtures({ root })).includes(ERROR_CODES.NOT_CANONICAL));
  });

  it('detects Stellar secret seeds and refuses to --write over them', () => {
    editJson(root, 'fixtures/e2e-seed.json', (s) => {
      s.tokens[0].name = `leaked S${'A'.repeat(55)}`;
    });
    assert.ok(codes(fixtures.checkFixtures({ root })).includes(ERROR_CODES.SECRET_DETECTED));
    const before = fs.readFileSync(path.join(root, 'fixtures/manifest.json'), 'utf8');
    const result = fixtures.writeFixtures({ root, env: {} });
    assert.ok(codes(result).includes(ERROR_CODES.SECRET_DETECTED));
    assert.deepEqual(result.written, []);
    assert.equal(fs.readFileSync(path.join(root, 'fixtures/manifest.json'), 'utf8'), before);
  });

  it('detects drift between JSON vectors and the cl-pool Rust fixture test', () => {
    const file = path.join(root, CL_POOL_LIB);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('(100, 79624303326835659281511670087)', '(100, 1)')
    );
    const errors = fixtures.checkFixtures({ root }).errors;
    assert.deepEqual(
      errors.map((e) => e.code),
      [ERROR_CODES.CONSUMER_DRIFT]
    );
    assert.match(errors[0].message, /only in Rust: 100=1/);
  });

  it('rejects manifest mirrors that escape the repo', () => {
    editJson(root, 'fixtures/manifest.json', (m) => {
      m.fixtures[0].mirrors.push('../outside.json');
    });
    assert.ok(codes(fixtures.checkFixtures({ root })).includes(ERROR_CODES.MANIFEST_INVALID));
  });

  it('rejects unknown validators', () => {
    editJson(root, 'fixtures/manifest.json', (m) => {
      m.fixtures[1].validator = 'anything-goes';
    });
    assert.ok(codes(fixtures.checkFixtures({ root })).includes(ERROR_CODES.MANIFEST_INVALID));
  });

  it('fails closed when the manifest is missing', () => {
    fs.rmSync(path.join(root, 'fixtures/manifest.json'));
    assert.deepEqual(codes(fixtures.checkFixtures({ root })), [ERROR_CODES.MANIFEST_INVALID]);
  });

  it('refuses --write under CI and leaves files untouched', () => {
    fs.writeFileSync(path.join(root, MIRROR_FILES[0]), '{}\n');
    const result = fixtures.writeFixtures({ root, env: { CI: 'true' } });
    assert.deepEqual(codes(result), [ERROR_CODES.WRITE_IN_CI]);
    assert.equal(fs.readFileSync(path.join(root, MIRROR_FILES[0]), 'utf8'), '{}\n');
  });
});

describe('validateE2eSeed', () => {
  const seed = () =>
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fixtures/e2e-seed.json'), 'utf8'));

  it('accepts the canonical seed', () => {
    assert.deepEqual(fixtures.validateE2eSeed(seed()), []);
  });

  it('rejects non-UTC and unpinned timestamps', () => {
    for (const bad of ['2026-01-01', '2026-01-01T00:00:00+01:00', 'now', null]) {
      const s = seed();
      s.clock.now = bad;
      assert.deepEqual(
        fixtures.validateE2eSeed(s).map((e) => e.code),
        [ERROR_CODES.NONDETERMINISTIC_TIME],
        String(bad)
      );
    }
  });

  it('rejects inverted tick ranges and low > high candles', () => {
    const s = seed();
    s.positions[0].lowerTick = 60;
    s.positions[0].upperTick = -60;
    s.priceCandles[0].low = 2;
    const messages = fixtures.validateE2eSeed(s).map((e) => e.message);
    assert.ok(messages.some((m) => m.includes('lowerTick < upperTick')));
    assert.ok(messages.some((m) => m.includes('low <= high')));
  });

  it('accepts signed swap amounts but not signed liquidity', () => {
    const s = seed();
    s.swaps[0].amount1 = '-5';
    assert.deepEqual(fixtures.validateE2eSeed(s), []);
    s.pools[0].liquidity = '-5';
    assert.deepEqual(
      fixtures.validateE2eSeed(s).map((e) => e.code),
      [ERROR_CODES.SCHEMA_VIOLATION]
    );
  });
});

describe('validateClMathVectors', () => {
  it('requires at least 3 vectors and ordered price bounds', () => {
    const errors = fixtures.validateClMathVectors({
      Q96: '1',
      tick_to_sqrt_price: [],
      amounts_for_liquidity: [
        {
          name: 'x',
          sqrtPriceX96: '1',
          sqrtPriceLowerX96: '5',
          sqrtPriceUpperX96: '4',
          liquidity: '1',
          amount0: '0',
          amount1: '0',
        },
      ],
    });
    const messages = errors.map((e) => e.message).join('\n');
    assert.match(messages, /tick_to_sqrt_price needs at least 3/);
    assert.match(messages, /amounts_for_liquidity needs at least 3/);
    assert.match(messages, /sqrtPriceLowerX96 < sqrtPriceUpperX96/);
  });
});

describe('correlation ids and CLI', () => {
  it('strips log-injection characters from correlation ids', () => {
    assert.equal(fixtures.sanitizeCorrelationId('abc\n{"status":"ok"}'), 'abcstatusok');
    assert.equal(fixtures.sanitizeCorrelationId('\n\n'), null);
    assert.equal(fixtures.sanitizeCorrelationId('x'.repeat(100)).length, 64);
  });

  it('derives correlation ids from GitHub run metadata', () => {
    assert.equal(
      fixtures.resolveCorrelationId({ GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2' }),
      '42-2-fixtures'
    );
    assert.equal(fixtures.resolveCorrelationId({ FIXTURE_CORRELATION_ID: 'abc' }), 'abc');
  });

  it('returns exit code 2 for unknown flags', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(fixtures.main(['--force'], {}), 2);
    } finally {
      console.error = originalError;
    }
  });
});
