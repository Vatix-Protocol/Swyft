import { ConfigService } from '@nestjs/config';

import { jwtModuleOptionsFactory, resolveJwtSecret } from './auth.module';

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

describe('resolveJwtSecret secret leakage', () => {
  const originalEnv = process.env.NODE_ENV;
  const SENTINEL = 'SENTINEL_SECRET_VALUE';

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  function configWith(secret: string): ConfigService {
    return { getOrThrow: () => secret } as unknown as ConfigService;
  }

  it('does not include the secret in the rejection error or logs', () => {
    process.env.NODE_ENV = 'production';
    const logSpies = (['log', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    const config = {
      getOrThrow: jest.fn().mockReturnValueOnce('change-me-in-production'),
    } as unknown as ConfigService;

    let message = '';
    try {
      resolveJwtSecret(config);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toBe(
      'JWT_SECRET is set to the insecure default "change-me-in-production". ' +
        'Set a unique secret before starting the API in production.',
    );
    expect(message).not.toContain(SENTINEL);

    expect(resolveJwtSecret(configWith(SENTINEL))).toBe(SENTINEL);
    for (const spy of logSpies) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain(SENTINEL);
      }
    }
  });
});

describe('jwtModuleOptionsFactory expiresIn', () => {
  function configWith(expiresIn: string | undefined): ConfigService {
    return {
      getOrThrow: () => 'a-real-unique-secret',
      get: (key: string) => (key === 'JWT_EXPIRES_IN' ? expiresIn : undefined),
    } as unknown as ConfigService;
  }

  it('falls back to 15m when JWT_EXPIRES_IN is unset', () => {
    const options = jwtModuleOptionsFactory(configWith(undefined));
    expect(options.signOptions.expiresIn).toBe('15m');
    expect(options.secret).toBe('a-real-unique-secret');
  });

  it('passes a configured 5m through unchanged', () => {
    const options = jwtModuleOptionsFactory(configWith('5m'));
    expect(options.signOptions.expiresIn).toBe('5m');
  });
});
