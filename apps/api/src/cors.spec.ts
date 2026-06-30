import { getCorsOrigins } from './cors';

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
});
