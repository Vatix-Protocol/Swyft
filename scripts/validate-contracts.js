#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
