import { getCorsOrigins, isOriginAllowed, buildCorsOptions } from './cors';

describe('getCorsOrigins', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to the local web app origin', () => {
    process.env = { ...originalEnv };
    delete process.env.WEB_APP_ORIGIN;
    delete process.env.CORS_ORIGIN;

    expect(getCorsOrigins()).toEqual(['http://localhost:3000']);
  });

  it('parses comma-separated web app origins', () => {
    process.env = {
      ...originalEnv,
      WEB_APP_ORIGIN: 'https://app.swyft.example, http://localhost:3000',
    };

    expect(getCorsOrigins()).toEqual([
      'https://app.swyft.example',
      'http://localhost:3000',
    ]);
  });

  it('prefers CORS_ORIGIN over WEB_APP_ORIGIN when both are set', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://api.swyft.example',
      WEB_APP_ORIGIN: 'https://app.swyft.example',
    };

    expect(getCorsOrigins()).toEqual(['https://api.swyft.example']);
  });

  it('trims whitespace and drops empty entries', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: ' https://app.swyft.example ,, http://localhost:3000 ',
    };

    expect(getCorsOrigins()).toEqual([
      'https://app.swyft.example',
      'http://localhost:3000',
    ]);
  });
});

describe('isOriginAllowed', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows origins on the allowlist', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.swyft.example',
    };

    expect(isOriginAllowed('https://app.swyft.example')).toBe(true);
  });

  it('denies origins not on the allowlist (fail-closed)', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.swyft.example',
    };

    expect(isOriginAllowed('https://evil.example')).toBe(false);
  });

  it('denies requests with no origin header', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.swyft.example',
    };

    expect(isOriginAllowed(undefined)).toBe(false);
  });

  it('does not reflect arbitrary origins', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.swyft.example',
    };

    expect(isOriginAllowed('https://app.swyft.example.evil.com')).toBe(false);
  });
});

describe('buildCorsOptions', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('never uses a wildcard origin when credentials are enabled', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.swyft.example',
    };

    const options = buildCorsOptions();

    expect(options.credentials).toBe(true);
    expect(options.origin).not.toBe('*');
  });

  it('only echoes allowlisted origins via the origin callback', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.swyft.example',
    };

    const options = buildCorsOptions();
    const originFn = options.origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;

    let allowed: boolean | undefined;
    originFn('https://app.swyft.example', (_err, allow) => {
      allowed = allow;
    });
    expect(allowed).toBe(true);

    let denied: boolean | undefined;
    originFn('https://evil.example', (_err, allow) => {
      denied = allow;
    });
    expect(denied).toBe(false);
  });

  it('supports environment-specific allowlists without drift', () => {
    process.env = {
      ...originalEnv,
      CORS_ORIGIN: 'https://app.testnet.swyft.example',
    };

    expect(isOriginAllowed('https://app.testnet.swyft.example')).toBe(true);
    expect(isOriginAllowed('https://app.mainnet.swyft.example')).toBe(false);
  });
});
