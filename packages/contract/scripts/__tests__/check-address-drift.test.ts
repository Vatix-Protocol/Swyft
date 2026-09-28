import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeWasmHash, detectDrift, manifestKeysByContract } from '../check-address-drift.js';

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

  it('reports deployed contracts with no recorded hash', () => {
    const manifest = { contracts: { pool: 'CPOOL...' }, wasmHashes: {} };
    expect(detectDrift(manifest, { pool: 'hash-a' })).toEqual(['pool']);
  });

  it('reports deployed contracts when a fresh hash is unavailable', () => {
    const manifest = {
      contracts: { pool: 'CPOOL...' },
      wasmHashes: { pool: 'hash-a' },
    };
    expect(detectDrift(manifest, {})).toEqual(['pool']);
  });

  it('skips undeployed contracts even when their hashes differ', () => {
    const manifest = { contracts: {}, wasmHashes: { pool: 'hash-a' } };
    expect(detectDrift(manifest, { pool: 'hash-b' })).toEqual([]);
  });
});

describe('computeWasmHash', () => {
  it('returns the SHA-256 digest of the exact WASM bytes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-wasm-hash-'));
    const wasmPath = path.join(tempDir, 'contract.wasm');
    const bytes = Buffer.from('known wasm bytes');
    fs.writeFileSync(wasmPath, bytes);

    try {
      expect(computeWasmHash(wasmPath)).toBe(
        crypto.createHash('sha256').update(bytes).digest('hex')
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('manifestKeysByContract', () => {
  it('checks both addresses backed by the shared oracle-adapter WASM', () => {
    expect(manifestKeysByContract['oracle-adapter']).toEqual([
      'oracleAdapter',
      'clPoolOracleAdapter',
    ]);
  });
});
