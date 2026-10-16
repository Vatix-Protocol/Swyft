import { readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist', 'esm');

// Per-entrypoint raw/gzip budgets in bytes.
// Keep this map in sync with the entrypoints declared in tsup.config.ts.
// A test asserts the two lists match so the map cannot drift silently.
const budgets = {
  'index.mjs': { raw: 30 * 1024, gzip: 12 * 1024 },
  'quote.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'liquidity.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'queries.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'swap.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'types.mjs': { raw: 20 * 1024, gzip: 8 * 1024 },
  'config.mjs': { raw: 20 * 1024, gzip: 8 * 1024 },
  'position-math.mjs': { raw: 50 * 1024, gzip: 20 * 1024 },
  'errors.mjs': { raw: 20 * 1024, gzip: 8 * 1024 },
};

let failed = false;

for (const [file, budget] of Object.entries(budgets)) {
  const filePath = join(distDir, file);

  if (!existsSync(filePath)) {
    console.error(`✗ ${file}: missing from dist/esm (expected entrypoint was not emitted)`);
    failed = true;
    continue;
  }

  const raw = statSync(filePath).size;
  const gzip = gzipSync(readFileSync(filePath)).length;

  const rawOk = raw <= budget.raw;
  const gzipOk = gzip <= budget.gzip;

  if (!rawOk || !gzipOk) {
    console.error(
      `✗ ${file}: raw ${raw}B (budget ${budget.raw}B), gzip ${gzip}B (budget ${budget.gzip}B)`,
    );
    failed = true;
  } else {
    console.log(
      `✓ ${file}: raw ${raw}B (budget ${budget.raw}B), gzip ${gzip}B (budget ${budget.gzip}B)`,
    );
  }
}

if (failed) {
  console.error('\nBundle budget check failed.');
  process.exit(1);
}

console.log('\nBundle budget check passed.');
