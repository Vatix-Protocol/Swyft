import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = join(here, '..', '..');

// Parse the entry keys out of tsup.config.ts so this test stays in sync with
// the build without duplicating the list. The `entry` object literal is a flat
// map of `key: 'src/....ts'` pairs.
function readEntryKeys() {
  const config = readFileSync(join(sdkRoot, 'tsup.config.ts'), 'utf8');
  const match = config.match(/const\s+entry\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(match, 'could not locate the `entry` object in tsup.config.ts');

  const keys = [];
  const re = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_$]+))\s*:/gm;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    keys.push(m[1] ?? m[2] ?? m[3]);
  }
  assert.ok(keys.length > 0, 'no entry keys found in tsup.config.ts');
  return keys;
}

const entryKeys = readEntryKeys();

// Each entrypoint must produce a file in every dist format directory.
const distFormats = [
  { dir: 'dist/esm', ext: '.js' },
  { dir: 'dist/cjs', ext: '.cjs' },
  { dir: 'dist/types', ext: '.d.ts' },
];

for (const key of entryKeys) {
  for (const { dir, ext } of distFormats) {
    test(`${dir}/${key}${ext} exists for entrypoint "${key}"`, () => {
      const file = join(sdkRoot, dir, `${key}${ext}`);
      assert.ok(
        existsSync(file),
        `expected ${dir}/${key}${ext} to exist after build (entrypoint "${key}")`,
      );
    });
  }
}

// Every entrypoint must be reachable as a subpath in package.json `exports`.
test('package.json exports exposes a subpath for every entrypoint', () => {
  const pkg = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
  const exportsMap = pkg.exports ?? {};

  for (const key of entryKeys) {
    const subpath = key === 'index' ? '.' : `./${key}`;
    assert.ok(
      Object.prototype.hasOwnProperty.call(exportsMap, subpath),
      `package.json exports is missing subpath "${subpath}" for entrypoint "${key}"`,
    );
  }
});
