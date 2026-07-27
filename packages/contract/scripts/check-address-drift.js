#!/usr/bin/env node
// check-address-drift.js — compares wasm hashes recorded in a deployments
// manifest (written by deploy-testnet.sh) against freshly-built hashes for
// the same contracts, to catch contracts whose source has changed since the
// address in the manifest was deployed.

const crypto = require('crypto');
const fs = require('fs');

/**
 * computeWasmHash() — sha256 hex digest of a compiled .wasm file.
 * @param {string} wasmPath Absolute path to the .wasm file.
 * @returns {string} Hex-encoded sha256 digest.
 */
function computeWasmHash(wasmPath) {
  const buf = fs.readFileSync(wasmPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * detectDrift() — finds deployed contracts whose recorded wasm hash no
 * longer matches a freshly-computed hash for the same contract.
 *
 * A contract is only checked when it has BOTH a deployed address in
 * `manifest.contracts` AND a recorded hash in `manifest.wasmHashes` AND a
 * fresh hash was supplied for it — undeployed or unhashed contracts are
 * skipped rather than treated as drifted.
 *
 * @param {{contracts?: Record<string,string>, wasmHashes?: Record<string,string>}} manifest
 * @param {Record<string,string>} freshHashesByKey Freshly computed wasm hash per manifest key.
 * @returns {string[]} Manifest keys whose address has drifted from current source.
 */
function detectDrift(manifest, freshHashesByKey) {
  const contracts = manifest.contracts || {};
  const recordedHashes = manifest.wasmHashes || {};
  const drifted = [];

  for (const key of Object.keys(contracts)) {
    const address = contracts[key];
    if (!address) continue;

    const recorded = recordedHashes[key];
    const fresh = freshHashesByKey[key];
    if (!recorded || !fresh) continue;

    if (recorded !== fresh) {
      drifted.push(key);
    }
  }

  return drifted;
}

module.exports = { computeWasmHash, detectDrift };
