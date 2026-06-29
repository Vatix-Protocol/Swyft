import { stellarConfig, STELLAR_CONFIG_KEY } from './stellar.config';

/**
 * Validates that the stellarConfig factory:
 *   - returns correct values for valid env vars
 *   - applies safe testnet defaults when vars are missing
 *   - throws a descriptive error for malformed URLs
 *   - throws for invalid STELLAR_NETWORK values
 */
describe('stellarConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns configured values when all env vars are valid', () => {
    process.env.STELLAR_RPC_URL = 'https://rpc.example.com';
    process.env.HORIZON_URL = 'https://horizon.example.com';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.POOL_CONTRACT_ID = 'CPOOL123';

    const cfg = stellarConfig();

    expect(cfg.rpcUrl).toBe('https://rpc.example.com');
    expect(cfg.horizonUrl).toBe('https://horizon.example.com');
    expect(cfg.network).toBe('mainnet');
    expect(cfg.poolContractId).toBe('CPOOL123');
  });

  it('applies testnet defaults when env vars are absent', () => {
    delete process.env.STELLAR_RPC_URL;
    delete process.env.HORIZON_URL;
    delete process.env.STELLAR_NETWORK;
    delete process.env.POOL_CONTRACT_ID;

    const cfg = stellarConfig();

    expect(cfg.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(cfg.network).toBe('testnet');
    expect(cfg.poolContractId).toBe('');
  });

  it('throws a descriptive error when STELLAR_RPC_URL is not a valid URL', () => {
    process.env.STELLAR_RPC_URL = 'not-a-url';
    process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';

    expect(() => stellarConfig()).toThrow(/Stellar configuration is invalid/);
    expect(() => stellarConfig()).toThrow(/STELLAR_RPC_URL/);
  });

  it('throws a descriptive error when HORIZON_URL is not a valid URL', () => {
    process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.HORIZON_URL = 'ftp://bad-scheme.example.com';

    expect(() => stellarConfig()).toThrow(/Stellar configuration is invalid/);
    expect(() => stellarConfig()).toThrow(/HORIZON_URL/);
  });

  it('throws when STELLAR_NETWORK is not testnet or mainnet', () => {
    process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
    process.env.STELLAR_NETWORK = 'devnet';

    expect(() => stellarConfig()).toThrow(/Stellar configuration is invalid/);
    expect(() => stellarConfig()).toThrow(/STELLAR_NETWORK/);
  });

  it('accepts http:// URLs for local development', () => {
    process.env.STELLAR_RPC_URL = 'http://localhost:8000';
    process.env.HORIZON_URL = 'http://localhost:8001';
    process.env.STELLAR_NETWORK = 'testnet';

    const cfg = stellarConfig();

    expect(cfg.rpcUrl).toBe('http://localhost:8000');
    expect(cfg.horizonUrl).toBe('http://localhost:8001');
  });

  it('exports the correct config namespace key', () => {
    expect(STELLAR_CONFIG_KEY).toBe('stellar');
  });

  it('poolContractId defaults to empty string when POOL_CONTRACT_ID is unset', () => {
    delete process.env.POOL_CONTRACT_ID;

    const cfg = stellarConfig();

    expect(cfg.poolContractId).toBe('');
  });
});
