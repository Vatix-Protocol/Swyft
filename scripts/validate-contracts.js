#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { computeWasmHash, detectDrift } = require('../packages/contract/scripts/check-address-drift.js');

const contracts = [
  'hello-world',
  'math-lib',
  'pool',
  'pool-factory',
  'router',
  'position-nft',
  'fee-collector',
  'oracle-adapter',
  'cl-pool',
];

// Maps a contract's folder name to its key in deployments/testnet.json.
// hello-world has no entry — deploy-testnet.sh never deploys it to testnet.
const manifestKeyByContract = {
  'math-lib': 'mathLib',
  pool: 'pool',
  'pool-factory': 'poolFactory',
  router: 'router',
  'position-nft': 'positionNft',
  'fee-collector': 'feeCollector',
  'oracle-adapter': 'oracleAdapter',
  'cl-pool': 'clPool',
};

const checkDrift = process.argv.includes('--check-drift');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

log('Validating Swyft contracts...\n', 'yellow');

let passed = 0;
let failed = 0;
const root = path.dirname(__dirname); // Swyft root
const contractsPath = path.join(root, 'packages', 'contract', 'contracts');
const wasmDir = path.join(root, 'packages', 'contract', 'target', 'wasm32-unknown-unknown', 'release');
const manifestPath = path.join(root, 'packages', 'contract', 'deployments', 'testnet.json');
const freshHashes = {};

for (const contract of contracts) {
  process.stdout.write(`Building ${contract}... `);

  const contractPath = path.join(contractsPath, contract);

  if (!fs.existsSync(contractPath)) {
    log('✗ (not found)', 'red');
    failed++;
    continue;
  }

  try {
    execSync(`cd "${contractPath}" && cargo build --target wasm32-unknown-unknown --release`, {
      stdio: 'pipe',
      timeout: 60000,
    });
    log('✓', 'green');
    passed++;

    const manifestKey = manifestKeyByContract[contract];
    if (checkDrift && manifestKey) {
      const wasmPath = path.join(wasmDir, `${contract.replace(/-/g, '_')}.wasm`);
      if (fs.existsSync(wasmPath)) {
        freshHashes[manifestKey] = computeWasmHash(wasmPath);
      }
    }
  } catch (e) {
    log('✗', 'red');
    failed++;
  }
}

console.log('');
log(`Passed: ${passed}/${contracts.length}`, 'green');
if (failed > 0) {
  log(`Failed: ${failed}/${contracts.length}`, 'red');
  process.exit(1);
}

log('\nAll Swyft contracts validated!', 'green');

if (checkDrift) {
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { contracts: {}, wasmHashes: {} };
  const drifted = detectDrift(manifest, freshHashes);

  if (drifted.length > 0) {
    log(`\nAddress drift detected: ${drifted.join(', ')}`, 'red');
    log(
      'These contracts are deployed at an address that no longer matches the current build. ' +
        'Redeploy (scripts/deploy-testnet.sh) and commit the updated deployments/testnet.json.',
      'red'
    );
    process.exit(1);
  }

  log('\nNo address drift detected.', 'green');
}
