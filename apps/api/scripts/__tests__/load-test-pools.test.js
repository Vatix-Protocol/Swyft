const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ERROR_CODES,
  LoadTestError,
  resolveConfig,
} = require('../load-test-pools');

const validEnv = {
  SWYFT_API_BASE_URL: 'https://staging.example.com',
  SWYFT_LOADTEST_TOKEN: 'test-token',
  SWYFT_NETWORK: 'testnet',
  NODE_ENV: 'staging',
};

test('allows a non-production testnet target', () => {
  assert.equal(resolveConfig(validEnv).network, 'testnet');
});

test('rejects mainnet even when writes are disabled', () => {
  assert.throws(
    () =>
      resolveConfig({
        ...validEnv,
        SWYFT_NETWORK: 'mainnet',
        SWYFT_LOADTEST_ALLOW_WRITES: 'false',
      }),
    (error) =>
      error instanceof LoadTestError &&
      error.code === ERROR_CODES.MAINNET_BLOCKED,
  );
});

test('rejects production targets even when configured as testnet', () => {
  assert.throws(
    () => resolveConfig({ ...validEnv, NODE_ENV: 'production' }),
    (error) =>
      error instanceof LoadTestError &&
      error.code === ERROR_CODES.MAINNET_BLOCKED,
  );
});
