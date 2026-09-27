#!/usr/bin/env node
/**
 * Deterministic fixture gate for fixtures/ (issue #1037).
 *
 * Usage:
 *   node scripts/fixtures.js            # check (default, read-only, fail-closed)
 *   node scripts/fixtures.js --write    # re-canonicalise, sync mirrors, refresh hashes
 *
 * Invariants enforced (see fixtures/README.md):
 *   - Every *.json in fixtures/ is registered in fixtures/manifest.json (deny-by-default).
 *   - Canonical files are byte-stable: JSON.stringify(value, null, 2) + "\n".
 *   - The sha256 recorded in the manifest matches the file, so any edit is intentional.
 *   - Mirrors (package-local copies) are byte-identical to the canonical file.
 *   - Content passes its validator: integer-string amounts, UTC ISO timestamps,
 *     testnet-only, valid StrKey addresses, unique keys, no dangling references.
 *   - No Stellar secret seeds anywhere in fixtures.
 *   - Hard-coded consumers (cl-pool Rust fixture_tests) agree with the JSON.
 *
 * --write refuses to run under CI so drift can never be "auto-healed" by a pipeline.
 * Exit codes: 0 ok, 1 fixture errors, 2 usage error.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.dirname(__dirname);
const FIXTURES_DIR = 'fixtures';
const MANIFEST_FILE = 'manifest.json';

/** Stable error codes. Never rename — CI logs and runbooks key off these. */
const ERROR_CODES = Object.freeze({
  MANIFEST_INVALID: 'FIXTURE_MANIFEST_INVALID',
  UNREGISTERED: 'FIXTURE_UNREGISTERED',
  MISSING: 'FIXTURE_MISSING',
  PARSE_ERROR: 'FIXTURE_PARSE_ERROR',
  NOT_CANONICAL: 'FIXTURE_NOT_CANONICAL',
  HASH_MISMATCH: 'FIXTURE_HASH_MISMATCH',
  MIRROR_DRIFT: 'FIXTURE_MIRROR_DRIFT',
  SCHEMA_VIOLATION: 'FIXTURE_SCHEMA_VIOLATION',
  NONDETERMINISTIC_TIME: 'FIXTURE_NONDETERMINISTIC_TIME',
  INVALID_ADDRESS: 'FIXTURE_INVALID_ADDRESS',
  NETWORK_NOT_TESTNET: 'FIXTURE_NETWORK_NOT_TESTNET',
  DUPLICATE_KEY: 'FIXTURE_DUPLICATE_KEY',
  DANGLING_REF: 'FIXTURE_DANGLING_REF',
  SECRET_DETECTED: 'FIXTURE_SECRET_DETECTED',
  CONSUMER_DRIFT: 'FIXTURE_CONSUMER_DRIFT',
  WRITE_IN_CI: 'FIXTURE_WRITE_IN_CI',
});

// Errors that `--write` is allowed to repair. Everything else must be fixed by hand.
const WRITE_REPAIRABLE = new Set([
  ERROR_CODES.NOT_CANONICAL,
  ERROR_CODES.HASH_MISMATCH,
  ERROR_CODES.MIRROR_DRIFT,
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fixtureError(code, file, message) {
  return { code, file, message };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Restrict correlation ids to a log-safe charset so they cannot inject log lines. */
function sanitizeCorrelationId(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 64);
  return cleaned || null;
}

function resolveCorrelationId(env) {
  const explicit = sanitizeCorrelationId(env.FIXTURE_CORRELATION_ID);
  if (explicit) return explicit;
  if (env.GITHUB_RUN_ID) {
    return sanitizeCorrelationId(`${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}-fixtures`);
  }
  return `local-${process.pid}`;
}

function isCi(env) {
  const value = String(env.CI ?? '').toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

/** Repo-relative path that stays inside the repo (rejects absolute and `..` escapes). */
function isSafeRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0 || path.isAbsolute(p)) return false;
  const normalized = path.posix.normalize(p.replace(/\\/g, '/'));
  return !normalized.startsWith('../') && normalized !== '..';
}

// ── Stellar StrKey (ed25519 public key) ───────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ED25519_PUBLIC_KEY_VERSION = 6 << 3; // 'G'

function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function crc16Xmodem(bytes) {
  let crc = 0x0000;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** True when `value` is a checksum-valid Stellar account id (G...). */
function isValidStellarPublicKey(value) {
  if (typeof value !== 'string' || !/^G[A-Z2-7]{55}$/.test(value)) return false;
  const decoded = base32Decode(value);
  if (!decoded || decoded.length !== 35) return false;
  if (decoded[0] !== ED25519_PUBLIC_KEY_VERSION) return false;
  const payload = decoded.subarray(0, 33);
  const checksum = decoded.readUInt16LE(33);
  return crc16Xmodem(payload) === checksum;
}

// Anything shaped like a Stellar secret seed is rejected even if the checksum is bogus.
const SECRET_SEED_PATTERN = /S[A-Z2-7]{55}/;

function findSecrets(value, pointer = '') {
  if (typeof value === 'string') {
    return SECRET_SEED_PATTERN.test(value) ? [pointer || '/'] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findSecrets(item, `${pointer}/${i}`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => findSecrets(item, `${pointer}/${key}`));
  }
  return [];
}

// ── Validators ────────────────────────────────────────────────────────────────

const UNSIGNED_INT_STRING = /^(0|[1-9]\d*)$/;
const SIGNED_INT_STRING = /^(0|-?[1-9]\d*)$/;
const DECIMAL_STRING = /^(0|[1-9]\d*)(\.\d+)?$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function makeCollector(file) {
  const errors = [];
  return {
    errors,
    push(code, message) {
      errors.push(fixtureError(code, file, message));
    },
  };
}

function requireArray(c, data, key) {
  if (!Array.isArray(data[key])) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, `"${key}" must be an array`);
    return [];
  }
  return data[key];
}

function checkIntString(c, value, where, signed = false) {
  const pattern = signed ? SIGNED_INT_STRING : UNSIGNED_INT_STRING;
  if (typeof value !== 'string' || !pattern.test(value)) {
    c.push(
      ERROR_CODES.SCHEMA_VIOLATION,
      `${where} must be a ${signed ? 'signed ' : ''}integer string (got ${JSON.stringify(value)})`
    );
  }
}

function checkInt(c, value, where) {
  if (!Number.isSafeInteger(value)) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, `${where} must be a safe integer`);
  }
}

function checkTimestamp(c, value, where) {
  if (
    typeof value !== 'string' ||
    !ISO_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    c.push(
      ERROR_CODES.NONDETERMINISTIC_TIME,
      `${where} must be a fixed UTC ISO-8601 timestamp like 2026-01-01T00:00:00.000Z (got ${JSON.stringify(value)})`
    );
  }
}

function checkAddress(c, value, where) {
  if (!isValidStellarPublicKey(value)) {
    c.push(ERROR_CODES.INVALID_ADDRESS, `${where} is not a checksum-valid Stellar G-address`);
  }
}

function checkUnique(c, items, key, label) {
  const seen = new Set();
  for (const item of items) {
    const k = typeof key === 'function' ? key(item) : item?.[key];
    if (seen.has(k)) c.push(ERROR_CODES.DUPLICATE_KEY, `duplicate ${label} ${JSON.stringify(k)}`);
    seen.add(k);
  }
}

/** Validates fixtures/cl-math-vectors.json (shared SDK ↔ cl-pool math vectors). */
function validateClMathVectors(data, file = 'cl-math-vectors.json') {
  const c = makeCollector(file);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, 'root must be an object');
    return c.errors;
  }
  checkIntString(c, data.Q96, 'Q96');

  const ticks = requireArray(c, data, 'tick_to_sqrt_price');
  if (ticks.length < 3) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, 'tick_to_sqrt_price needs at least 3 vectors');
  }
  ticks.forEach((v, i) => {
    checkInt(c, v?.tick, `tick_to_sqrt_price[${i}].tick`);
    checkIntString(c, v?.sqrtPriceX96, `tick_to_sqrt_price[${i}].sqrtPriceX96`);
  });
  checkUnique(c, ticks, 'tick', 'tick');

  const amounts = requireArray(c, data, 'amounts_for_liquidity');
  if (amounts.length < 3) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, 'amounts_for_liquidity needs at least 3 vectors');
  }
  amounts.forEach((v, i) => {
    if (typeof v?.name !== 'string' || v.name.length === 0) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `amounts_for_liquidity[${i}].name is required`);
    }
    for (const field of [
      'sqrtPriceX96',
      'sqrtPriceLowerX96',
      'sqrtPriceUpperX96',
      'liquidity',
      'amount0',
      'amount1',
    ]) {
      checkIntString(c, v?.[field], `amounts_for_liquidity[${i}].${field}`);
    }
    if (
      UNSIGNED_INT_STRING.test(v?.sqrtPriceLowerX96) &&
      UNSIGNED_INT_STRING.test(v?.sqrtPriceUpperX96) &&
      BigInt(v.sqrtPriceLowerX96) >= BigInt(v.sqrtPriceUpperX96)
    ) {
      c.push(
        ERROR_CODES.SCHEMA_VIOLATION,
        `amounts_for_liquidity[${i}] requires sqrtPriceLowerX96 < sqrtPriceUpperX96`
      );
    }
  });
  checkUnique(c, amounts, 'name', 'amounts_for_liquidity name');
  return c.errors;
}

/** Validates fixtures/e2e-seed.json (deterministic DB seed for local dev + e2e). */
function validateE2eSeed(data, file = 'e2e-seed.json') {
  const c = makeCollector(file);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, 'root must be an object');
    return c.errors;
  }
  if (data.version !== 1) {
    c.push(ERROR_CODES.SCHEMA_VIOLATION, `unsupported version ${JSON.stringify(data.version)}`);
  }
  if (data.network !== 'testnet') {
    c.push(
      ERROR_CODES.NETWORK_NOT_TESTNET,
      `network must be "testnet" (got ${JSON.stringify(data.network)}); e2e fixtures never target mainnet`
    );
  }
  checkTimestamp(c, data.clock?.now, 'clock.now');

  const tokens = requireArray(c, data, 'tokens');
  tokens.forEach((t, i) => {
    checkAddress(c, t?.address, `tokens[${i}].address`);
    if (typeof t?.symbol !== 'string' || !/^[A-Za-z0-9]{1,12}$/.test(t.symbol)) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `tokens[${i}].symbol must be 1-12 alphanumerics`);
    }
    if (typeof t?.name !== 'string' || t.name.length === 0) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `tokens[${i}].name is required`);
    }
    if (!Number.isInteger(t?.decimals) || t.decimals < 0 || t.decimals > 18) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `tokens[${i}].decimals must be an integer in [0, 18]`);
    }
  });
  checkUnique(c, tokens, 'address', 'token address');
  const tokenAddresses = new Set(tokens.map((t) => t?.address));

  const pools = requireArray(c, data, 'pools');
  pools.forEach((p, i) => {
    const at = `pools[${i}]`;
    if (typeof p?.id !== 'string' || p.id.length === 0) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.id is required`);
    }
    for (const side of ['token0Address', 'token1Address']) {
      if (!tokenAddresses.has(p?.[side])) {
        c.push(ERROR_CODES.DANGLING_REF, `${at}.${side} does not reference a fixture token`);
      }
    }
    if (p?.token0Address === p?.token1Address) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at} token0Address and token1Address must differ`);
    }
    checkInt(c, p?.feeTier, `${at}.feeTier`);
    checkInt(c, p?.currentTick, `${at}.currentTick`);
    for (const field of ['currentSqrtPrice', 'liquidity', 'tvl', 'volume24h']) {
      checkIntString(c, p?.[field], `${at}.${field}`);
    }
    if (typeof p?.feeApr !== 'string' || !DECIMAL_STRING.test(p.feeApr)) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.feeApr must be a decimal string`);
    }
    checkTimestamp(c, p?.createdAt, `${at}.createdAt`);
  });
  checkUnique(c, pools, 'id', 'pool id');
  const poolIds = new Set(pools.map((p) => p?.id));

  const positions = requireArray(c, data, 'positions');
  positions.forEach((p, i) => {
    const at = `positions[${i}]`;
    if (typeof p?.id !== 'string' || p.id.length === 0) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.id is required`);
    }
    if (!poolIds.has(p?.poolId)) {
      c.push(ERROR_CODES.DANGLING_REF, `${at}.poolId does not reference a fixture pool`);
    }
    checkAddress(c, p?.ownerAddress, `${at}.ownerAddress`);
    checkIntString(c, p?.tokenId, `${at}.tokenId`);
    checkInt(c, p?.lowerTick, `${at}.lowerTick`);
    checkInt(c, p?.upperTick, `${at}.upperTick`);
    if (
      Number.isInteger(p?.lowerTick) &&
      Number.isInteger(p?.upperTick) &&
      p.lowerTick >= p.upperTick
    ) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at} requires lowerTick < upperTick`);
    }
    for (const field of ['liquidity', 'feesCollected0', 'feesCollected1']) {
      checkIntString(c, p?.[field], `${at}.${field}`);
    }
    checkTimestamp(c, p?.createdAt, `${at}.createdAt`);
  });
  checkUnique(c, positions, 'id', 'position id');
  checkUnique(c, positions, (p) => `${p?.poolId}:${p?.tokenId}`, 'position poolId:tokenId');

  const swaps = requireArray(c, data, 'swaps');
  swaps.forEach((s, i) => {
    const at = `swaps[${i}]`;
    if (typeof s?.eventId !== 'string' || s.eventId.length === 0) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.eventId is required (idempotency key)`);
    }
    if (!poolIds.has(s?.poolId)) {
      c.push(ERROR_CODES.DANGLING_REF, `${at}.poolId does not reference a fixture pool`);
    }
    checkAddress(c, s?.senderAddress, `${at}.senderAddress`);
    checkAddress(c, s?.recipientAddress, `${at}.recipientAddress`);
    checkIntString(c, s?.amount0, `${at}.amount0`, true);
    checkIntString(c, s?.amount1, `${at}.amount1`, true);
    checkIntString(c, s?.sqrtPriceAfter, `${at}.sqrtPriceAfter`);
    checkInt(c, s?.tickAfter, `${at}.tickAfter`);
    if (typeof s?.transactionHash !== 'string' || s.transactionHash.length === 0) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.transactionHash is required`);
    }
    checkTimestamp(c, s?.timestamp, `${at}.timestamp`);
  });
  checkUnique(c, swaps, 'eventId', 'swap eventId');

  const candles = requireArray(c, data, 'priceCandles');
  candles.forEach((k, i) => {
    const at = `priceCandles[${i}]`;
    if (!poolIds.has(k?.poolId)) {
      c.push(ERROR_CODES.DANGLING_REF, `${at}.poolId does not reference a fixture pool`);
    }
    if (typeof k?.interval !== 'string' || !/^\d+[mhd]$/.test(k.interval)) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.interval must look like 1m / 1h / 1d`);
    }
    for (const field of ['open', 'high', 'low', 'close', 'volumeUsd']) {
      if (typeof k?.[field] !== 'number' || !Number.isFinite(k[field]) || k[field] < 0) {
        c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at}.${field} must be a finite non-negative number`);
      }
    }
    if (typeof k?.low === 'number' && typeof k?.high === 'number' && k.low > k.high) {
      c.push(ERROR_CODES.SCHEMA_VIOLATION, `${at} requires low <= high`);
    }
    checkTimestamp(c, k?.periodStart, `${at}.periodStart`);
  });
  checkUnique(
    c,
    candles,
    (k) => `${k?.poolId}:${k?.interval}:${k?.periodStart}`,
    'price candle poolId:interval:periodStart'
  );

  return c.errors;
}

const VALIDATORS = Object.freeze({
  'cl-math-vectors': validateClMathVectors,
  'e2e-seed': validateE2eSeed,
});

// ── Hard-coded consumer parity ────────────────────────────────────────────────

const CL_POOL_LIB = 'packages/contract/contracts/cl-pool/src/lib.rs';

/** Parses the `(tick, sqrt_price)` tuples out of cl-pool's `fixture_tests` module. */
function parseRustTickVectors(source) {
  const start = source.indexOf('mod fixture_tests');
  if (start === -1) return null;
  const block = source.slice(start, source.indexOf('\n}', start));
  const vectors = [];
  for (const match of block.matchAll(/\(\s*(-?\d+)\s*,\s*(\d+)\s*\)/g)) {
    vectors.push({ tick: Number(match[1]), sqrtPriceX96: match[2] });
  }
  return vectors;
}

function checkClPoolParity(root, data) {
  const file = CL_POOL_LIB;
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    return [fixtureError(ERROR_CODES.CONSUMER_DRIFT, file, 'cl-pool fixture consumer not found')];
  }
  const rust = parseRustTickVectors(fs.readFileSync(abs, 'utf8'));
  if (!rust || rust.length === 0) {
    return [
      fixtureError(ERROR_CODES.CONSUMER_DRIFT, file, 'no tick vectors found in mod fixture_tests'),
    ];
  }
  const key = (v) => `${v.tick}=${v.sqrtPriceX96}`;
  const json = new Set((data.tick_to_sqrt_price || []).map(key));
  const rs = new Set(rust.map(key));
  const onlyJson = [...json].filter((k) => !rs.has(k));
  const onlyRust = [...rs].filter((k) => !json.has(k));
  if (onlyJson.length === 0 && onlyRust.length === 0) return [];
  return [
    fixtureError(
      ERROR_CODES.CONSUMER_DRIFT,
      file,
      `tick_to_sqrt_price diverges from fixtures/cl-math-vectors.json ` +
        `(only in JSON: ${onlyJson.join(', ') || '-'}; only in Rust: ${onlyRust.join(', ') || '-'})`
    ),
  ];
}

const CONSUMER_CHECKS = Object.freeze({
  'cl-math-vectors': checkClPoolParity,
});

// ── Manifest ──────────────────────────────────────────────────────────────────

function loadManifest(root) {
  const rel = `${FIXTURES_DIR}/${MANIFEST_FILE}`;
  const abs = path.join(root, rel);
  const invalid = (message) => ({
    manifest: null,
    errors: [fixtureError(ERROR_CODES.MANIFEST_INVALID, rel, message)],
  });

  if (!fs.existsSync(abs)) return invalid('manifest.json is missing');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return invalid(`manifest.json is not valid JSON: ${err.message}`);
  }
  if (manifest?.version !== 1 || !Array.isArray(manifest.fixtures)) {
    return invalid('manifest must be { "version": 1, "fixtures": [...] }');
  }

  const errors = [];
  const seen = new Set();
  for (const [i, entry] of manifest.fixtures.entries()) {
    const at = `fixtures[${i}]`;
    if (typeof entry?.file !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.json$/.test(entry.file)) {
      errors.push(
        fixtureError(ERROR_CODES.MANIFEST_INVALID, rel, `${at}.file must be a flat *.json name`)
      );
      continue;
    }
    if (entry.file === MANIFEST_FILE || seen.has(entry.file)) {
      errors.push(
        fixtureError(
          ERROR_CODES.MANIFEST_INVALID,
          rel,
          `${at}.file ${entry.file} is duplicated or reserved`
        )
      );
    }
    seen.add(entry.file);
    if (!Object.prototype.hasOwnProperty.call(VALIDATORS, entry.validator)) {
      errors.push(
        fixtureError(
          ERROR_CODES.MANIFEST_INVALID,
          rel,
          `${at}.validator ${JSON.stringify(entry.validator)} is unknown`
        )
      );
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      errors.push(
        fixtureError(
          ERROR_CODES.MANIFEST_INVALID,
          rel,
          `${at}.sha256 must be 64 lowercase hex chars`
        )
      );
    }
    if (!Array.isArray(entry.mirrors) || !entry.mirrors.every(isSafeRelativePath)) {
      errors.push(
        fixtureError(
          ERROR_CODES.MANIFEST_INVALID,
          rel,
          `${at}.mirrors must be repo-relative paths inside the repo`
        )
      );
    }
  }
  return { manifest, errors };
}

// ── Check / write ─────────────────────────────────────────────────────────────

function readFixture(root, entry) {
  const rel = `${FIXTURES_DIR}/${entry.file}`;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    return {
      errors: [fixtureError(ERROR_CODES.MISSING, rel, 'registered fixture does not exist')],
    };
  }
  const raw = fs.readFileSync(abs);
  try {
    return { rel, raw, data: JSON.parse(raw.toString('utf8')), errors: [] };
  } catch (err) {
    return { errors: [fixtureError(ERROR_CODES.PARSE_ERROR, rel, err.message)] };
  }
}

/**
 * Runs every fixture invariant. Read-only.
 * @returns {{ errors: Array<{code: string, file: string, message: string}>, fixtures: number }}
 */
function checkFixtures({ root = DEFAULT_ROOT } = {}) {
  const { manifest, errors } = loadManifest(root);
  if (!manifest) return { errors, fixtures: 0 };

  const registered = new Set(manifest.fixtures.map((f) => f?.file));
  for (const name of fs.readdirSync(path.join(root, FIXTURES_DIR))) {
    if (name.endsWith('.json') && name !== MANIFEST_FILE && !registered.has(name)) {
      errors.push(
        fixtureError(
          ERROR_CODES.UNREGISTERED,
          `${FIXTURES_DIR}/${name}`,
          'fixture is not registered in fixtures/manifest.json'
        )
      );
    }
  }

  for (const entry of manifest.fixtures) {
    if (typeof entry?.file !== 'string' || !VALIDATORS[entry.validator]) continue;
    const { rel, raw, data, errors: readErrors } = readFixture(root, entry);
    errors.push(...readErrors);
    if (!raw) continue;

    for (const pointer of findSecrets(data)) {
      errors.push(
        fixtureError(
          ERROR_CODES.SECRET_DETECTED,
          rel,
          `value at ${pointer} looks like a Stellar secret seed`
        )
      );
    }
    if (raw.toString('utf8') !== canonicalJson(data)) {
      errors.push(
        fixtureError(
          ERROR_CODES.NOT_CANONICAL,
          rel,
          'not in canonical form (2-space JSON + trailing newline)'
        )
      );
    }
    if (sha256(raw) !== entry.sha256) {
      errors.push(
        fixtureError(
          ERROR_CODES.HASH_MISMATCH,
          rel,
          'content changed without updating manifest sha256'
        )
      );
    }
    for (const mirror of Array.isArray(entry.mirrors) ? entry.mirrors : []) {
      const mirrorAbs = path.join(root, mirror);
      if (!fs.existsSync(mirrorAbs) || !fs.readFileSync(mirrorAbs).equals(raw)) {
        errors.push(fixtureError(ERROR_CODES.MIRROR_DRIFT, mirror, `mirror differs from ${rel}`));
      }
    }
    errors.push(...VALIDATORS[entry.validator](data, rel));
    const consumerCheck = CONSUMER_CHECKS[entry.validator];
    if (consumerCheck) errors.push(...consumerCheck(root, data));
  }

  return { errors, fixtures: manifest.fixtures.length };
}

/**
 * Re-canonicalises fixtures, syncs mirrors and refreshes manifest hashes.
 * Refuses under CI and refuses when non-repairable errors exist (fail-closed).
 */
function writeFixtures({ root = DEFAULT_ROOT, env = process.env } = {}) {
  if (isCi(env)) {
    return {
      errors: [
        fixtureError(
          ERROR_CODES.WRITE_IN_CI,
          FIXTURES_DIR,
          '--write is disabled under CI; run it locally and commit'
        ),
      ],
      written: [],
    };
  }
  const blocking = checkFixtures({ root }).errors.filter((e) => !WRITE_REPAIRABLE.has(e.code));
  if (blocking.length > 0) return { errors: blocking, written: [] };

  const manifestPath = path.join(root, FIXTURES_DIR, MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const written = [];
  for (const entry of manifest.fixtures) {
    const abs = path.join(root, FIXTURES_DIR, entry.file);
    const canonical = canonicalJson(JSON.parse(fs.readFileSync(abs, 'utf8')));
    if (fs.readFileSync(abs, 'utf8') !== canonical) {
      fs.writeFileSync(abs, canonical);
      written.push(`${FIXTURES_DIR}/${entry.file}`);
    }
    for (const mirror of entry.mirrors) {
      const mirrorAbs = path.join(root, mirror);
      if (!fs.existsSync(mirrorAbs) || fs.readFileSync(mirrorAbs, 'utf8') !== canonical) {
        fs.mkdirSync(path.dirname(mirrorAbs), { recursive: true });
        fs.writeFileSync(mirrorAbs, canonical);
        written.push(mirror);
      }
    }
    entry.sha256 = sha256(Buffer.from(canonical, 'utf8'));
  }
  const manifestText = canonicalJson(manifest);
  if (fs.readFileSync(manifestPath, 'utf8') !== manifestText) {
    fs.writeFileSync(manifestPath, manifestText);
    written.push(`${FIXTURES_DIR}/${MANIFEST_FILE}`);
  }
  return { errors: [], written };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function summarize(event, correlationId, errors, extra) {
  const byCode = {};
  for (const e of errors) byCode[e.code] = (byCode[e.code] || 0) + 1;
  return JSON.stringify({
    event,
    correlationId,
    status: errors.length === 0 ? 'ok' : 'fail',
    errorCount: errors.length,
    errorsByCode: byCode,
    ...extra,
  });
}

function main(argv = process.argv.slice(2), env = process.env) {
  const unknown = argv.filter((a) => a !== '--write' && a !== '--check');
  if (unknown.length > 0 || (argv.includes('--write') && argv.includes('--check'))) {
    console.error(
      `Usage: node scripts/fixtures.js [--check | --write] (unknown: ${unknown.join(' ')})`
    );
    return 2;
  }
  const correlationId = resolveCorrelationId(env);
  const write = argv.includes('--write');

  const result = write ? writeFixtures({ env }) : checkFixtures();
  for (const e of result.errors) {
    console.error(`✖ [${e.code}] ${e.file}: ${e.message}`);
  }
  if (write) {
    for (const file of result.written) console.log(`✎ wrote ${file}`);
  }
  if (result.errors.length === 0) {
    console.log(
      write ? '✔ fixtures synced' : `✔ ${result.fixtures} fixture(s) deterministic and in sync`
    );
  } else if (!write) {
    const repairable = result.errors.every((e) => WRITE_REPAIRABLE.has(e.code));
    console.error(
      repairable
        ? '\nRun `pnpm fixtures:write` locally, review the diff, and commit.'
        : '\nFix the errors above by hand; see fixtures/README.md.'
    );
  }
  console.log(
    summarize(write ? 'fixtures.write' : 'fixtures.check', correlationId, result.errors, {
      written: write ? result.written.length : undefined,
    })
  );
  return result.errors.length === 0 ? 0 : 1;
}

module.exports = {
  ERROR_CODES,
  canonicalJson,
  checkFixtures,
  isValidStellarPublicKey,
  main,
  parseRustTickVectors,
  resolveCorrelationId,
  sanitizeCorrelationId,
  validateClMathVectors,
  validateE2eSeed,
  writeFixtures,
};

if (require.main === module) {
  process.exitCode = main();
}
