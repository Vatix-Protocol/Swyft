import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detectDrift } from '../check-address-drift.js';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');

function loadFixture(name: string) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

describe('detectDrift', () => {
  const manifest = loadFixture('testnet.manifest.json');

  it('reports no drift when recorded and fresh hashes match', () => {
    const drifted = detectDrift(manifest, { pool: 'hash-a', router: 'hash-b' });
    expect(drifted).toEqual([]);
  });

  it('fails on an intentional mismatch fixture', () => {
    // "pool" was rebuilt (hash changed) but the manifest still records the old hash.
    const drifted = detectDrift(manifest, { pool: 'hash-a-rebuilt', router: 'hash-b' });
    expect(drifted).toEqual(['pool']);
  });

  it('skips contracts that were never deployed', () => {
    const manifest = { contracts: { pool: '' }, wasmHashes: {} };
    expect(detectDrift(manifest, { pool: 'anything' })).toEqual([]);
  });

  it('skips contracts with no recorded hash on either side', () => {
    const manifest = { contracts: { pool: 'CPOOL...' }, wasmHashes: {} };
    expect(detectDrift(manifest, {})).toEqual([]);
  });
});
