import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esmDir = resolve(root, 'dist/esm');
const budgets = {
  // Keep the root barrel useful for compatibility, while requiring consumers
  // with narrow imports to remain small.
  'index.mjs': { raw: 100 * 1024, gzip: 35 * 1024 },
  'quote.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'liquidity.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'queries.mjs': { raw: 30 * 1024, gzip: 12 * 1024 },
  'swap.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'types.mjs': { raw: 5 * 1024, gzip: 2 * 1024 },
  'config.mjs': { raw: 10 * 1024, gzip: 4 * 1024 },
  'errors.mjs': { raw: 20 * 1024, gzip: 8 * 1024 },
};

if (!existsSync(esmDir)) {
  throw new Error('SDK bundle is missing. Run `pnpm --filter @swyft/sdk build` first.');
}

const files = new Set(readdirSync(esmDir).filter((file) => file.endsWith('.mjs')));
const missing = Object.keys(budgets).filter((file) => !files.has(file));
if (missing.length > 0) {
  throw new Error(`SDK bundle is missing expected entrypoints: ${missing.join(', ')}`);
}

const failures = [];
for (const [file, budget] of Object.entries(budgets)) {
  const path = resolve(esmDir, file);
  const rawBytes = statSync(path).size;
  const gzipBytes = gzipSync(readFileSync(path), { level: 9 }).length;
  const rawOk = rawBytes <= budget.raw;
  const gzipOk = gzipBytes <= budget.gzip;

  console.log(
    `${file}: ${rawBytes} B raw (limit ${budget.raw}), ${gzipBytes} B gzip (limit ${budget.gzip})`
  );
  if (!rawOk || !gzipOk) {
    failures.push(
      `${file} exceeds ${!rawOk ? 'raw' : ''}${!rawOk && !gzipOk ? ' and ' : ''}${!gzipOk ? 'gzip' : ''} budget`
    );
  }
}

if (failures.length > 0) {
  throw new Error(`SDK bundle budget failed: ${failures.join('; ')}`);
}
