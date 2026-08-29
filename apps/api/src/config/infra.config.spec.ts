import { infraConfig } from './infra.config';

/**
 * Validates that the infraConfig factory:
 *   - returns configured values for valid DATABASE_URL / REDIS_URL
 *   - applies the safe local Redis default when REDIS_URL is missing
 *   - throws a descriptive error for a malformed DATABASE_URL
 *   - throws a descriptive error for a malformed REDIS_URL
 *   - fails fast in production when either var is unset
 */
describe('infraConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns configured values when both env vars are valid', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/swyft';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.NODE_ENV = 'test';

    const cfg = infraConfig();

    expect(cfg.databaseUrl).toBe('postgresql://user:pass@localhost:5432/swyft');
    expect(cfg.redisUrl).toBe('redis://localhost:6379');
  });

  it('applies the local Redis default when REDIS_URL is absent', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/swyft';
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'development';

    const cfg = infraConfig();

    expect(cfg.redisUrl).toBe('redis://localhost:6379');
  });

  it('throws a descriptive error when DATABASE_URL is not a valid Postgres URL', () => {
    process.env.DATABASE_URL = 'not-a-url';
    process.env.NODE_ENV = 'development';

    expect(() => infraConfig()).toThrow(/Infra configuration is invalid/);
    expect(() => infraConfig()).toThrow(/DATABASE_URL/);
  });

  it('throws a descriptive error when REDIS_URL is not a valid Redis URL', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/swyft';
    process.env.REDIS_URL = 'http://bad-scheme.example.com';
    process.env.NODE_ENV = 'development';

    expect(() => infraConfig()).toThrow(/Infra configuration is invalid/);
    expect(() => infraConfig()).toThrow(/REDIS_URL/);
  });

  it('fails fast in production when DATABASE_URL or REDIS_URL is unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'production';

    expect(() => infraConfig()).toThrow(/must be set in production/);
  });
});
