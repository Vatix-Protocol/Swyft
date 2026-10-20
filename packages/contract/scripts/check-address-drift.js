#!/usr/bin/env node
// check-address-drift.js — compares wasm hashes recorded in a deployments
// manifest (written by deploy-testnet.sh) against freshly-built hashes for
// the same contracts, to catch contracts whose source has changed since the
// address in the manifest was deployed.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const manifestKeysByContract = {
  'math-lib': ['mathLib'],
  pool: ['pool'],
  'pool-factory': ['poolFactory'],
  router: ['router'],
  'position-nft': ['positionNft'],
  'fee-collector': ['feeCollector'],
  'oracle-adapter': ['oracleAdapter', 'clPoolOracleAdapter'],
  'cl-pool': ['clPool'],
};

/**
 * computeWasmHash() — sha256 hex digest of a compiled .wasm file.
 * @param {string} wasmPath Absolute path to the .wasm file.
 * @returns {string} Hex-encoded sha256 digest.
 */
function computeWasmHash(wasmPath) {
  const buf = fs.readFileSync(wasmPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * assertManifestShape() — throws a descriptive Error when the manifest (or
 * its contracts/wasmHashes fields) is not a plain object, so a corrupted
 * manifest fails loudly instead of producing a cryptic TypeError.
 * @param {unknown} manifest
 */
function assertManifestShape(manifest) {
  if (!isPlainObject(manifest)) {
    throw new Error('invalid manifest: manifest must be a plain object');
  }
  if (
    Object.prototype.hasOwnProperty.call(manifest, 'contracts') &&
    !isPlainObject(manifest.contracts)
  ) {
    throw new Error('invalid manifest: contracts must be a plain object');
  }
  if (
    Object.prototype.hasOwnProperty.call(manifest, 'wasmHashes') &&
    !isPlainObject(manifest.wasmHashes)
  ) {
    throw new Error('invalid manifest: wasmHashes must be a plain object');
  }
}

/**
 * detectDrift() — finds deployed contracts whose recorded wasm hash no
 * longer matches a freshly-computed hash for the same contract.
 *
 * A deployed contract is drifted when its recorded hash is missing, its fresh
 * hash is missing, or the two hashes differ. Undeployed contracts are skipped.
 *
 * @param {{contracts?: Record<string,string>, wasmHashes?: Record<string,string>}} manifest
 * @param {Record<string,string>} freshHashesByKey Freshly computed wasm hash per manifest key.
 * @returns {string[]} Manifest keys whose address has drifted from current source.
 */
function detectDrift(manifest, freshHashesByKey) {
  assertManifestShape(manifest);
  const contracts = manifest.contracts || {};
  const recordedHashes = manifest.wasmHashes || {};
  const drifted = [];

  for (const key of Object.keys(contracts)) {
    const address = contracts[key];
    if (!address) continue;

    const recorded = recordedHashes[key];
    const fresh = freshHashesByKey[key];
    if (!recorded || !fresh || recorded !== fresh) {
      drifted.push(key);
    }
  }

  return drifted;
}

/**
 * buildFreshHashesByKey() — computes a fresh wasm hash for every contract in
 * manifestKeysByContract and assigns it to each manifest key that contract
 * maps to. Contracts whose .wasm file is absent are skipped (no fresh hash),
 * so detectDrift reports them as drifted when they are deployed.
 * @param {string} wasmDir Directory containing <contract>.wasm files.
 * @returns {Record<string,string>} Freshly computed wasm hash per manifest key.
 */
function buildFreshHashesByKey(wasmDir) {
  const freshHashesByKey = {};
  for (const [contract, keys] of Object.entries(manifestKeysByContract)) {
    const wasmPath = path.join(wasmDir, `${contract}.wasm`);
    let hash;
    try {
      hash = computeWasmHash(wasmPath);
    } catch {
      // No built wasm for this contract — leave its keys without a fresh hash.
      continue;
    }
    for (const key of keys) {
      freshHashesByKey[key] = hash;
    }
  }
  return freshHashesByKey;
}

/**
 * main() — CLI entrypoint. Reads the manifest path and wasm directory from
 * argv, computes fresh hashes, detects drift, prints the drifted keys, and
 * sets process.exitCode (0 = no drift, 1 = drift, 2 = usage error).
 * @param {string[]} argv
 */
function main(argv) {
  const manifestPath = argv[0];
  const wasmDir = argv[1];

  if (!manifestPath || !wasmDir) {
    console.error('Usage: node check-address-drift.js <manifest.json> <wasm-dir>');
    process.exitCode = 2;
    return;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const freshHashesByKey = buildFreshHashesByKey(wasmDir);
    const drifted = detectDrift(manifest, freshHashesByKey);

    if (drifted.length) {
      console.log(`Drifted contracts: ${drifted.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('No address drift detected.');
      process.exitCode = 0;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { computeWasmHash, detectDrift, manifestKeysByContract };
