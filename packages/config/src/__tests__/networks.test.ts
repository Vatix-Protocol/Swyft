/**
 * Unit tests for the @swyft/config network presets.
 *
 * These tests assert that:
 *  - Both networks have all required fields populated
 *  - Passphrases and URLs are the canonical Stellar values (single source of truth)
 *  - Helper functions return the right values
 *  - isStellarNetwork rejects invalid inputs
 *
 * Run:  cd packages/config && pnpm test
 */

import {
  NETWORK_PRESETS,
  getNetworkPassphrase,
  getNetworkRpcUrl,
  getNetworkHorizonUrl,
  getExplorerTxUrl,
  isStellarNetwork,
} from '../networks';

// ── Preset completeness ────────────────────────────────────────────────────────

describe('NETWORK_PRESETS', () => {
  const networks = ['TESTNET', 'PUBLIC'] as const;

  it.each(networks)('%s preset has all required fields', (network) => {
    const preset = NETWORK_PRESETS[network];
    expect(preset.label).toBeTruthy();
    expect(preset.passphrase).toBeTruthy();
    expect(preset.rpcUrl).toMatch(/^https?:\/\/.+/);
    expect(preset.horizonUrl).toMatch(/^https?:\/\/.+/);
    expect(preset.explorerBaseUrl).toMatch(/^https?:\/\/.+/);
  });

  it('TESTNET and PUBLIC have different passphrases', () => {
    expect(NETWORK_PRESETS.TESTNET.passphrase).not.toBe(NETWORK_PRESETS.PUBLIC.passphrase);
  });

  it('TESTNET and PUBLIC have different RPC URLs', () => {
    expect(NETWORK_PRESETS.TESTNET.rpcUrl).not.toBe(NETWORK_PRESETS.PUBLIC.rpcUrl);
  });
});

// ── Canonical values ───────────────────────────────────────────────────────────

describe('canonical network identifiers', () => {
  it('TESTNET passphrase matches official Stellar test network', () => {
    expect(NETWORK_PRESETS.TESTNET.passphrase).toBe('Test SDF Network ; September 2015');
  });

  it('PUBLIC passphrase matches official Stellar mainnet', () => {
    expect(NETWORK_PRESETS.PUBLIC.passphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
  });

  it('TESTNET RPC URL points to the SDF testnet endpoint', () => {
    expect(NETWORK_PRESETS.TESTNET.rpcUrl).toBe('https://soroban-testnet.stellar.org');
  });

  it('PUBLIC RPC URL points to the SDF mainnet endpoint', () => {
    expect(NETWORK_PRESETS.PUBLIC.rpcUrl).toBe('https://soroban-mainnet.stellar.org');
  });

  it('TESTNET Horizon URL is the SDF testnet Horizon', () => {
    expect(NETWORK_PRESETS.TESTNET.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('PUBLIC Horizon URL is the SDF mainnet Horizon', () => {
    expect(NETWORK_PRESETS.PUBLIC.horizonUrl).toBe('https://horizon.stellar.org');
  });
});

// ── getNetworkPassphrase ───────────────────────────────────────────────────────

describe('getNetworkPassphrase', () => {
  it('returns TESTNET passphrase', () => {
    expect(getNetworkPassphrase('TESTNET')).toBe('Test SDF Network ; September 2015');
  });

  it('returns PUBLIC passphrase', () => {
    expect(getNetworkPassphrase('PUBLIC')).toBe('Public Global Stellar Network ; September 2015');
  });
});

// ── getNetworkRpcUrl ───────────────────────────────────────────────────────────

describe('getNetworkRpcUrl', () => {
  it('returns TESTNET RPC URL', () => {
    expect(getNetworkRpcUrl('TESTNET')).toBe('https://soroban-testnet.stellar.org');
  });

  it('returns PUBLIC RPC URL', () => {
    expect(getNetworkRpcUrl('PUBLIC')).toBe('https://soroban-mainnet.stellar.org');
  });
});

// ── getNetworkHorizonUrl ───────────────────────────────────────────────────────

describe('getNetworkHorizonUrl', () => {
  it('returns TESTNET Horizon URL', () => {
    expect(getNetworkHorizonUrl('TESTNET')).toBe('https://horizon-testnet.stellar.org');
  });

  it('returns PUBLIC Horizon URL', () => {
    expect(getNetworkHorizonUrl('PUBLIC')).toBe('https://horizon.stellar.org');
  });
});

// ── getExplorerTxUrl ───────────────────────────────────────────────────────────

describe('getExplorerTxUrl', () => {
  const HASH = 'abc123def456';

  it('builds a testnet explorer URL', () => {
    expect(getExplorerTxUrl(HASH, 'TESTNET')).toBe(
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
  });

  it('builds a mainnet explorer URL', () => {
    expect(getExplorerTxUrl(HASH, 'PUBLIC')).toBe(
      `https://stellar.expert/explorer/public/tx/${HASH}`,
    );
  });

  it('defaults to TESTNET when no network is provided', () => {
    expect(getExplorerTxUrl(HASH)).toBe(
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
  });

  it('includes the full hash in the URL', () => {
    const longHash = 'a'.repeat(64);
    expect(getExplorerTxUrl(longHash, 'PUBLIC')).toContain(longHash);
  });
});

// ── isStellarNetwork ───────────────────────────────────────────────────────────

describe('isStellarNetwork', () => {
  it('accepts TESTNET', () => {
    expect(isStellarNetwork('TESTNET')).toBe(true);
  });

  it('accepts PUBLIC', () => {
    expect(isStellarNetwork('PUBLIC')).toBe(true);
  });

  it('rejects testnet (lowercase)', () => {
    expect(isStellarNetwork('testnet')).toBe(false);
  });

  it('rejects mainnet', () => {
    expect(isStellarNetwork('mainnet')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isStellarNetwork('')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isStellarNetwork(undefined)).toBe(false);
  });

  it('rejects null', () => {
    expect(isStellarNetwork(null)).toBe(false);
  });

  it('rejects numeric values', () => {
    expect(isStellarNetwork(1)).toBe(false);
  });
});
