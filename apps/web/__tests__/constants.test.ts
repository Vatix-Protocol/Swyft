import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getApiBase } from '@/lib/constants';

/**
 * getApiBase must resolve the API base URL per network:
 *
 *   per-network override (NEXT_PUBLIC_API_URL_TESTNET / _PUBLIC)
 *     → shared NEXT_PUBLIC_API_URL
 *     → http://localhost:3001
 *
 * and always append the /v1 suffix. The per-network overrides are what let a
 * single web build serve both testnet and mainnet traffic correctly: the
 * runtime network switcher (NetworkContext) picks the URL for the network the
 * user selected, so testnet and mainnet must be able to point at different
 * API deployments. If an override is unset or blank, the network must fall
 * back to the shared URL rather than producing a broken "/v1" URL.
 */

// Capture the pre-test values so we restore them after each test.
const ORIGINAL = {
  TESTNET: process.env.NEXT_PUBLIC_API_URL_TESTNET,
  PUBLIC: process.env.NEXT_PUBLIC_API_URL_PUBLIC,
  SHARED: process.env.NEXT_PUBLIC_API_URL,
};

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_API_URL_TESTNET;
  delete process.env.NEXT_PUBLIC_API_URL_PUBLIC;
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL_TESTNET = ORIGINAL.TESTNET;
  process.env.NEXT_PUBLIC_API_URL_PUBLIC = ORIGINAL.PUBLIC;
  process.env.NEXT_PUBLIC_API_URL = ORIGINAL.SHARED;
});

describe('getApiBase', () => {
  it('defaults both networks to localhost with the /v1 suffix', () => {
    expect(getApiBase('TESTNET')).toBe('http://localhost:3001/v1');
    expect(getApiBase('PUBLIC')).toBe('http://localhost:3001/v1');
  });

  it('falls back to NEXT_PUBLIC_API_URL for both networks when no override is set', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.swyft.example';

    expect(getApiBase('TESTNET')).toBe('https://api.swyft.example/v1');
    expect(getApiBase('PUBLIC')).toBe('https://api.swyft.example/v1');
  });

  it('honors NEXT_PUBLIC_API_URL_TESTNET only for the TESTNET network', () => {
    process.env.NEXT_PUBLIC_API_URL_TESTNET = 'https://api-testnet.swyft.example';

    expect(getApiBase('TESTNET')).toBe('https://api-testnet.swyft.example/v1');
    // PUBLIC must NOT inherit the testnet override.
    expect(getApiBase('PUBLIC')).toBe('http://localhost:3001/v1');
  });

  it('honors NEXT_PUBLIC_API_URL_PUBLIC only for the PUBLIC network', () => {
    process.env.NEXT_PUBLIC_API_URL_PUBLIC = 'https://api-mainnet.swyft.example';

    expect(getApiBase('PUBLIC')).toBe('https://api-mainnet.swyft.example/v1');
    // TESTNET must NOT inherit the mainnet override.
    expect(getApiBase('TESTNET')).toBe('http://localhost:3001/v1');
  });

  it('lets the per-network override win over the shared NEXT_PUBLIC_API_URL', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api-default.swyft.example';
    process.env.NEXT_PUBLIC_API_URL_PUBLIC = 'https://api-mainnet.swyft.example';

    expect(getApiBase('PUBLIC')).toBe('https://api-mainnet.swyft.example/v1');
    expect(getApiBase('TESTNET')).toBe('https://api-default.swyft.example/v1');
  });

  it('treats a blank override as unset instead of producing a broken "/v1" URL', () => {
    // A blank entry in .env (e.g. `NEXT_PUBLIC_API_URL_PUBLIC=`) is common —
    // it must fall through to the shared default, not yield "/v1".
    process.env.NEXT_PUBLIC_API_URL_PUBLIC = '';
    process.env.NEXT_PUBLIC_API_URL = 'https://api.swyft.example';

    expect(getApiBase('PUBLIC')).toBe('https://api.swyft.example/v1');
  });
});
