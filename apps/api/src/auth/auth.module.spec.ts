import { ConfigService } from '@nestjs/config';

import { resolveJwtSecret } from './auth.module';

/**
 * Validates that resolveJwtSecret refuses to boot with the insecure
 * placeholder JWT_SECRET from .env.example when running in production.
 */
describe('resolveJwtSecret', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  function configWith(secret: string): ConfigService {
    return {
      getOrThrow: () => secret,
    } as unknown as ConfigService;
  }

  it('throws in production when JWT_SECRET is the insecure default', () => {
    process.env.NODE_ENV = 'production';

    expect(() =>
      resolveJwtSecret(configWith('change-me-in-production')),
    ).toThrow(/insecure default/);
  });

  it('returns the secret in production when it has been changed', () => {
    process.env.NODE_ENV = 'production';

    expect(resolveJwtSecret(configWith('a-real-unique-secret'))).toBe(
      'a-real-unique-secret',
    );
  });

  it('allows the insecure default outside production', () => {
    process.env.NODE_ENV = 'development';

    expect(resolveJwtSecret(configWith('change-me-in-production'))).toBe(
      'change-me-in-production',
    );
  });
});
