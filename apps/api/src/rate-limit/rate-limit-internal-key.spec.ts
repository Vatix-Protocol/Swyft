import { RateLimitMiddleware } from './rate-limit.middleware';

/**
 * Internal-key rotation in the rate limiter (#1030): the bypass honours the
 * INTERNAL_API_KEY ring and the bucket identity never contains the raw key.
 */
describe('RateLimitMiddleware internal key ring', () => {
  const KEYS = [
    'INTERNAL_API_KEY',
    'INTERNAL_API_KEY_PREVIOUS',
    'INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT',
  ];
  const saved: Record<string, string | undefined> = {};
  const middleware = new RateLimitMiddleware() as unknown as {
    identityFor(req: unknown): string;
  };
  const req = (key?: string) => ({
    headers: key ? { 'x-internal-key': key } : {},
    ip: '10.0.0.1',
    socket: {},
  });

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.INTERNAL_API_KEY = 'current-secret';
    process.env.INTERNAL_API_KEY_PREVIOUS = 'previous-secret';
    process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = new Date(
      Date.now() + 60_000,
    ).toISOString();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('buckets internal callers by slot, never by raw key', () => {
    expect(middleware.identityFor(req('current-secret'))).toBe('internal:current');
    expect(middleware.identityFor(req('previous-secret'))).toBe('internal:previous');
  });

  it('treats an expired previous key as a public caller', () => {
    process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = new Date(
      Date.now() - 1,
    ).toISOString();
    expect(middleware.identityFor(req('previous-secret'))).toBe('10.0.0.1');
  });

  it('treats a wrong key as a public caller', () => {
    expect(middleware.identityFor(req('guess'))).toBe('10.0.0.1');
  });
});
