import { getCorsOrigins, validateCorsConfig } from './cors';

describe('getCorsOrigins', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('development mode', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'development' };
    });

    it('defaults to localhost when origins not set', () => {
      delete process.env.WEB_APP_ORIGIN;
      delete process.env.CORS_ORIGIN;

      expect(getCorsOrigins()).toEqual(['http://localhost:3000']);
    });

    it('parses comma-separated origins', () => {
      process.env.WEB_APP_ORIGIN =
        'https://app.swyft.example, http://localhost:3000';

      expect(getCorsOrigins()).toEqual([
        'https://app.swyft.example',
        'http://localhost:3000',
      ]);
    });

    it('prefers WEB_APP_ORIGIN over CORS_ORIGIN', () => {
      process.env.WEB_APP_ORIGIN = 'https://app.example.com';
      process.env.CORS_ORIGIN = 'https://fallback.example.com';

      expect(getCorsOrigins()).toContain('https://app.example.com');
    });
  });

  describe('production mode', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
    });

    it('requires explicit WEB_APP_ORIGIN or CORS_ORIGIN', () => {
      delete process.env.WEB_APP_ORIGIN;
      delete process.env.CORS_ORIGIN;

      expect(() => getCorsOrigins()).toThrow(
        'Production CORS: WEB_APP_ORIGIN or CORS_ORIGIN must be set',
      );
    });

    it('accepts production origins', () => {
      process.env.WEB_APP_ORIGIN = 'https://app.example.com';

      expect(getCorsOrigins()).toEqual(['https://app.example.com']);
    });

    it('rejects localhost in production', () => {
      process.env.WEB_APP_ORIGIN =
        'https://app.example.com,http://localhost:3000';

      expect(() => validateCorsConfig()).toThrow(
        'Production CORS validation failed: localhost/127.0.0.1 not allowed in production',
      );
    });

    it('rejects 127.0.0.1 in production', () => {
      process.env.WEB_APP_ORIGIN =
        'https://app.example.com,http://127.0.0.1:3000';

      expect(() => validateCorsConfig()).toThrow(
        'Production CORS validation failed: localhost/127.0.0.1 not allowed in production',
      );
    });
  });
});
