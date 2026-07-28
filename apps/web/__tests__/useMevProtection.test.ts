import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isValidRpcUrl, resolveRpcUrl } from '../hooks/useMevProtection';

// ── isValidRpcUrl ─────────────────────────────────────────────────────────────

describe('isValidRpcUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidRpcUrl('https://soroban-testnet.stellar.org')).toBe(true);
  });

  it('accepts http URLs (local dev)', () => {
    expect(isValidRpcUrl('http://localhost:8000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidRpcUrl('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidRpcUrl(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidRpcUrl(undefined)).toBe(false);
  });

  it('rejects a plain hostname with no protocol', () => {
    expect(isValidRpcUrl('soroban-testnet.stellar.org')).toBe(false);
  });

  it('rejects ftp:// scheme', () => {
    expect(isValidRpcUrl('ftp://example.com')).toBe(false);
  });

  it('rejects a relative path', () => {
    expect(isValidRpcUrl('/api/rpc')).toBe(false);
  });

  it('rejects random garbage strings', () => {
    expect(isValidRpcUrl('not-a-url')).toBe(false);
  });
});

// ── resolveRpcUrl ─────────────────────────────────────────────────────────────

describe('resolveRpcUrl', () => {
  const TESTNET = 'https://soroban-testnet.stellar.org';

  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
    delete process.env.NEXT_PUBLIC_MEV_PROTECTED_RPC_URL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the testnet fallback when no env vars are set', () => {
    expect(resolveRpcUrl(false)).toBe(TESTNET);
    expect(resolveRpcUrl(true)).toBe(TESTNET);
  });

  it('returns NEXT_PUBLIC_SOROBAN_RPC_URL when MEV is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://my-rpc.example.com');
    expect(resolveRpcUrl(false)).toBe('https://my-rpc.example.com');
  });

  it('returns NEXT_PUBLIC_MEV_PROTECTED_RPC_URL when MEV is enabled and URL is valid', () => {
    vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://normal-rpc.example.com');
    vi.stubEnv('NEXT_PUBLIC_MEV_PROTECTED_RPC_URL', 'https://mev-rpc.example.com');
    expect(resolveRpcUrl(true)).toBe('https://mev-rpc.example.com');
  });

  it('falls back to SOROBAN_RPC_URL when MEV is enabled but MEV URL is invalid', () => {
    vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://normal-rpc.example.com');
    vi.stubEnv('NEXT_PUBLIC_MEV_PROTECTED_RPC_URL', 'not-a-url');
    expect(resolveRpcUrl(true)).toBe('https://normal-rpc.example.com');
  });

  it('falls back to testnet when SOROBAN_RPC_URL is invalid and MEV is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'bad-url');
    expect(resolveRpcUrl(false)).toBe(TESTNET);
  });

  it('falls back to testnet when both env vars are invalid and MEV is enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'bad-url');
    vi.stubEnv('NEXT_PUBLIC_MEV_PROTECTED_RPC_URL', 'also-bad');
    expect(resolveRpcUrl(true)).toBe(TESTNET);
  });

  it('uses SOROBAN_RPC_URL even when MEV is disabled and MEV URL is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://normal-rpc.example.com');
    vi.stubEnv('NEXT_PUBLIC_MEV_PROTECTED_RPC_URL', 'https://mev-rpc.example.com');
    // MEV disabled — should NOT use the MEV URL
    expect(resolveRpcUrl(false)).toBe('https://normal-rpc.example.com');
  });
});
