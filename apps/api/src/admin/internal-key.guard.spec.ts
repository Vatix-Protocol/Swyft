import { validateInternalApiKeyConfig } from './internal-key.guard';

describe('validateInternalApiKeyConfig', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('development mode', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'development' };
    });

    it('does not throw when key is the placeholder', () => {
      process.env.INTERNAL_API_KEY = 'change-me-in-production';
      expect(() => validateInternalApiKeyConfig()).not.toThrow();
    });

    it('does not throw when key is unset', () => {
      delete process.env.INTERNAL_API_KEY;
      expect(() => validateInternalApiKeyConfig()).not.toThrow();
    });
  });

  describe('production mode', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
    });

    it('throws when key is unset', () => {
      delete process.env.INTERNAL_API_KEY;
      expect(() => validateInternalApiKeyConfig()).toThrow(
        'Production startup failed: INTERNAL_API_KEY must be set',
      );
    });

    it('throws when key is still the placeholder', () => {
      process.env.INTERNAL_API_KEY = 'change-me-in-production';
      expect(() => validateInternalApiKeyConfig()).toThrow(
        'Production startup failed: INTERNAL_API_KEY must be set',
      );
    });

    it('does not throw when key is set to a real value', () => {
      process.env.INTERNAL_API_KEY = 'a-real-secret-value';
      expect(() => validateInternalApiKeyConfig()).not.toThrow();
    });
  });
});
