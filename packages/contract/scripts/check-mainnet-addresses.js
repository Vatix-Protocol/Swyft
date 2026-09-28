#!/usr/bin/env node

const fs = require('fs');

const CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ADDRESS = /^G[A-Z2-7]{55}$/;

/**
 * Validate a mainnet deployment manifest before it is used by a production
 * deploy or indexer. Mainnet addresses require an explicit human review
 * record; testnet manifests must never be accepted for this purpose.
 */
function validateMainnetManifest(manifest) {
  const errors = [];
  if (manifest?.network !== 'mainnet') {
    errors.push('network must be "mainnet"');
  }
  if (manifest?.review?.approved !== true) {
    errors.push('review.approved must be true');
  }
  if (!manifest?.review?.reviewer || !manifest.review.reviewedAt) {
    errors.push('reviewer and reviewedAt are required');
  }
  if (!manifest?.deployer || !ACCOUNT_ADDRESS.test(manifest.deployer)) {
    errors.push('deployer must be a valid Stellar account address');
  }

  const contracts = manifest?.contracts;
  if (!contracts || typeof contracts !== 'object') {
    errors.push('contracts must be an object');
  } else {
    for (const [name, address] of Object.entries(contracts)) {
      if (typeof address !== 'string' || !CONTRACT_ADDRESS.test(address)) {
        errors.push(`contracts.${name} must be a valid Stellar contract address`);
      }
    }
  }
  return errors;
}

function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error('Usage: check-mainnet-addresses <manifest.json>');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = validateMainnetManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`MAINNET_ADDRESSES_REVIEW_FAILED: ${errors.join('; ')}`);
  }
  console.log(`Mainnet address review passed: ${manifestPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = { validateMainnetManifest };
