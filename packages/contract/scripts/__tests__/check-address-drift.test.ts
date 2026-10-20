import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
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

describe('check-address-drift CLI', () => {
  const SCRIPT = path.resolve(__dirname, '..', 'check-address-drift.js');

  function writeWasm(dir: string, name: string, bytes: Buffer): string {
    const wasmPath = path.join(dir, `${name}.wasm`);
    fs.writeFileSync(wasmPath, bytes);
    return wasmPath;
  }

  function hashOf(bytes: Buffer): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  function spawnCli(manifestPath: string, wasmDir: string) {
    return spawnSync(process.execPath, [SCRIPT, manifestPath, wasmDir], {
      encoding: 'utf8',
    });
  }

  it('exits 0 and reports no drift when recorded and fresh hashes match', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-drift-clean-'));
    const poolBytes = Buffer.from('pool-wasm-bytes');
    const routerBytes = Buffer.from('router-wasm-bytes');
    writeWasm(tmp, 'pool', poolBytes);
    writeWasm(tmp, 'router', routerBytes);

    const manifestPath = path.join(tmp, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        network: 'testnet',
        contracts: { pool: 'CPOOL', router: 'CROUTER' },
        wasmHashes: { pool: hashOf(poolBytes), router: hashOf(routerBytes) },
      })
    );

    try {
      const result = spawnCli(manifestPath, tmp);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No address drift detected');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits 1 and prints the drifted key when a recorded hash is stale', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-drift-drifted-'));
    const poolBytes = Buffer.from('pool-wasm-bytes');
    const routerBytes = Buffer.from('router-wasm-bytes');
    writeWasm(tmp, 'pool', poolBytes);
    writeWasm(tmp, 'router', routerBytes);

    const manifestPath = path.join(tmp, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        network: 'testnet',
        contracts: { pool: 'CPOOL', router: 'CROUTER' },
        wasmHashes: { pool: 'stale-hash', router: hashOf(routerBytes) },
      })
    );

    try {
      const result = spawnCli(manifestPath, tmp);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('pool');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits 1 with a descriptive message for a malformed manifest', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swyft-drift-malformed-'));
    const manifestPath = path.join(tmp, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ contracts: 'x' }));

    try {
      const result = spawnCli(manifestPath, tmp);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('invalid manifest');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('detectDrift manifest validation', () => {
  it('throws on a null manifest', () => {
    expect(() => detectDrift(null, {})).toThrow(
      'invalid manifest: manifest must be a plain object'
    );
  });

  it('throws on an array manifest', () => {
    expect(() => detectDrift([], {})).toThrow('invalid manifest: manifest must be a plain object');
  });

  it('throws when contracts is not an object', () => {
    expect(() => detectDrift({ contracts: 'x', wasmHashes: {} }, {})).toThrow(
      'invalid manifest: contracts must be a plain object'
    );
  });

  it('throws when wasmHashes is not an object', () => {
    expect(() => detectDrift({ contracts: {}, wasmHashes: 'x' }, {})).toThrow(
      'invalid manifest: wasmHashes must be a plain object'
    );
  });
});
