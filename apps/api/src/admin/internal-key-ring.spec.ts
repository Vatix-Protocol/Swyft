import { ExecutionContext, HttpException } from '@nestjs/common';
import {
  internalKeyAuthOutcomes,
  keyRingConfigProblems,
  loadKeyRing,
  matchKeyRing,
  MAX_ROTATION_WINDOW_MS,
} from './internal-key-ring';
import {
  FEE_COLLECTOR_AUTH_ERRORS,
  InternalKeyGuard,
  TESTNET_REDEPLOY_AUTH_ERRORS,
  TestnetRedeployGuard,
  validateInternalApiKeyConfig,
} from './internal-key.guard';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('internal key ring (#1030)', () => {
  const ring = (env: Record<string, string>) =>
    loadKeyRing('INTERNAL_API_KEY', env);

  it('accepts the current key', () => {
    expect(matchKeyRing('new-key', ring({ INTERNAL_API_KEY: 'new-key' }), NOW)).toEqual({
      ok: true,
      slot: 'current',
    });
  });

  it('fails closed when no current key is configured, even with a previous key', () => {
    const r = ring({
      INTERNAL_API_KEY_PREVIOUS: 'old-key',
      INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR),
    });
    expect(matchKeyRing('old-key', r, NOW)).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('treats empty strings as unset', () => {
    expect(matchKeyRing('', ring({ INTERNAL_API_KEY: '' }), NOW)).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it.each([undefined, '', ['a', 'b'], 42])('rejects a missing/non-string key %p', (key) => {
    expect(matchKeyRing(key, ring({ INTERNAL_API_KEY: 'k' }), NOW)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('accepts the previous key only inside the rotation window', () => {
    const r = ring({
      INTERNAL_API_KEY: 'new-key',
      INTERNAL_API_KEY_PREVIOUS: 'old-key',
      INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR),
    });
    expect(matchKeyRing('old-key', r, NOW)).toEqual({ ok: true, slot: 'previous' });
    expect(matchKeyRing('old-key', r, NOW + 2 * HOUR)).toEqual({
      ok: false,
      reason: 'previous_expired',
    });
    // Current key is unaffected by the window closing.
    expect(matchKeyRing('new-key', r, NOW + 2 * HOUR)).toEqual({ ok: true, slot: 'current' });
  });

  it.each([undefined, 'not-a-date'])(
    'never accepts a previous key without a valid expiry (%p)',
    (expiresAt) => {
      const env: Record<string, string> = {
        INTERNAL_API_KEY: 'new-key',
        INTERNAL_API_KEY_PREVIOUS: 'old-key',
      };
      if (expiresAt) env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = expiresAt;
      expect(matchKeyRing('old-key', ring(env), NOW)).toEqual({
        ok: false,
        reason: 'previous_expired',
      });
    },
  );

  it('rejects wrong keys including prefixes/suffixes of the real key', () => {
    const r = ring({ INTERNAL_API_KEY: 'new-key' });
    for (const key of ['new-ke', 'new-key ', 'NEW-KEY', 'x']) {
      expect(matchKeyRing(key, r, NOW)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  describe('keyRingConfigProblems', () => {
    const problems = (env: Record<string, string>) =>
      keyRingConfigProblems(loadKeyRing('INTERNAL_API_KEY', env), env, NOW);

    it('is empty for a plain key or a well-formed rotation', () => {
      expect(problems({ INTERNAL_API_KEY: 'a' })).toEqual([]);
      expect(
        problems({
          INTERNAL_API_KEY: 'a',
          INTERNAL_API_KEY_PREVIOUS: 'b',
          INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR),
        }),
      ).toEqual([]);
    });

    it('flags misconfigured rotations without echoing key material', () => {
      const cases: Record<string, string>[] = [
        { INTERNAL_API_KEY: 'same', INTERNAL_API_KEY_PREVIOUS: 'same', INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR) },
        { INTERNAL_API_KEY: 'a', INTERNAL_API_KEY_PREVIOUS: 'b' },
        { INTERNAL_API_KEY: 'a', INTERNAL_API_KEY_PREVIOUS: 'b', INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + MAX_ROTATION_WINDOW_MS + HOUR) },
        { INTERNAL_API_KEY: 'a', INTERNAL_API_KEY_PREVIOUS: 'change-me-in-production', INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR) },
        { INTERNAL_API_KEY: 'a', INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR) },
        { INTERNAL_API_KEY_PREVIOUS: 'b', INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(NOW + HOUR) },
      ];
      for (const env of cases) {
        const found = problems(env);
        expect(found.length).toBeGreaterThan(0);
        expect(found.join(' ')).not.toMatch(/\b(same|b)\b/);
      }
    });
  });
});

describe('validateInternalApiKeyConfig rotation checks', () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });

  it('refuses to boot in production with an open-ended rotation window', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      INTERNAL_API_KEY: 'real-new-key',
      INTERNAL_API_KEY_PREVIOUS: 'real-old-key',
    };
    delete process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT;
    expect(() => validateInternalApiKeyConfig()).toThrow(
      /invalid key rotation config: INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT/,
    );
  });

  it('validates the FEE_COLLECTOR_AUTH ring too', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      INTERNAL_API_KEY: 'real-new-key',
      FEE_COLLECTOR_AUTH: 'fc',
      FEE_COLLECTOR_AUTH_PREVIOUS: 'fc',
      FEE_COLLECTOR_AUTH_PREVIOUS_EXPIRES_AT: iso(Date.now() + HOUR),
    };
    expect(() => validateInternalApiKeyConfig()).toThrow(/FEE_COLLECTOR_AUTH_PREVIOUS must differ/);
  });

  it('boots with a valid rotation window', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      INTERNAL_API_KEY: 'real-new-key',
      INTERNAL_API_KEY_PREVIOUS: 'real-old-key',
      INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT: iso(Date.now() + HOUR),
    };
    expect(() => validateInternalApiKeyConfig()).not.toThrow();
  });
});

function ctx(headers: Record<string, string>, body: unknown = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, body }) }),
  } as unknown as ExecutionContext;
}

function rejection(fn: () => unknown): { status: number; body: Record<string, unknown> } {
  try {
    fn();
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
  }
  throw new Error('expected rejection');
}

describe('guards with key rotation', () => {
  const KEYS = [
    'INTERNAL_API_KEY',
    'INTERNAL_API_KEY_PREVIOUS',
    'INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT',
    'FEE_COLLECTOR_AUTH',
    'FEE_COLLECTOR_AUTH_PREVIOUS',
    'FEE_COLLECTOR_AUTH_PREVIOUS_EXPIRES_AT',
    'TESTNET_REDEPLOY_AUTH',
    'TESTNET_REDEPLOY_AUTH_PREVIOUS',
    'TESTNET_REDEPLOY_AUTH_PREVIOUS_EXPIRES_AT',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    internalKeyAuthOutcomes.reset();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('InternalKeyGuard', () => {
    const guard = new InternalKeyGuard();

    it('accepts previous INTERNAL_API_KEY during the window and records the slot', () => {
      process.env.INTERNAL_API_KEY = 'new';
      process.env.INTERNAL_API_KEY_PREVIOUS = 'old';
      process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = iso(Date.now() + HOUR);
      expect(guard.canActivate(ctx({ 'x-internal-key': 'old' }))).toBe(true);
      expect(guard.canActivate(ctx({ 'x-internal-key': 'new' }))).toBe(true);
      const snap = internalKeyAuthOutcomes.snapshot();
      expect(snap['fee_collector:previous']).toBe(1);
      expect(snap['fee_collector:current']).toBe(1);
    });

    it('rejects the previous key after expiry with the stable EXPIRED code', () => {
      process.env.INTERNAL_API_KEY = 'new';
      process.env.INTERNAL_API_KEY_PREVIOUS = 'old';
      process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = iso(Date.now() - 1000);
      const res = rejection(() =>
        guard.canActivate(ctx({ 'x-internal-key': 'old', 'x-correlation-id': 'cid-9' })),
      );
      expect(res).toEqual({
        status: 401,
        body: {
          code: FEE_COLLECTOR_AUTH_ERRORS.EXPIRED,
          message: 'Fee collector credentials expired',
          correlationId: 'cid-9',
        },
      });
      expect(internalKeyAuthOutcomes.snapshot()['fee_collector:previous_expired']).toBe(1);
    });

    it('does not cross rings: INTERNAL_API_KEY_PREVIOUS is ignored when FEE_COLLECTOR_AUTH is set', () => {
      process.env.FEE_COLLECTOR_AUTH = 'fc';
      process.env.INTERNAL_API_KEY = 'new';
      process.env.INTERNAL_API_KEY_PREVIOUS = 'old';
      process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = iso(Date.now() + HOUR);
      expect(rejection(() => guard.canActivate(ctx({ 'x-internal-key': 'old' }))).body.code).toBe(
        FEE_COLLECTOR_AUTH_ERRORS.INVALID_KEY,
      );
      expect(rejection(() => guard.canActivate(ctx({ 'x-internal-key': 'new' }))).body.code).toBe(
        FEE_COLLECTOR_AUTH_ERRORS.INVALID_KEY,
      );
      expect(guard.canActivate(ctx({ 'x-internal-key': 'fc' }))).toBe(true);
    });

    it('fails closed when FEE_COLLECTOR_AUTH is defined but empty', () => {
      process.env.FEE_COLLECTOR_AUTH = '';
      process.env.INTERNAL_API_KEY = 'new';
      expect(rejection(() => guard.canActivate(ctx({ 'x-internal-key': 'new' }))).body.code).toBe(
        FEE_COLLECTOR_AUTH_ERRORS.NOT_CONFIGURED,
      );
    });

    it.each([
      [{}, FEE_COLLECTOR_AUTH_ERRORS.MISSING_KEY],
      [{ 'x-internal-key': 'nope' }, FEE_COLLECTOR_AUTH_ERRORS.INVALID_KEY],
    ])('rejects %p with %s', (headers, code) => {
      process.env.INTERNAL_API_KEY = 'new';
      expect(rejection(() => guard.canActivate(ctx(headers))).body.code).toBe(code);
    });

    it('still enforces the wrong-role check after a valid rotated key', () => {
      process.env.INTERNAL_API_KEY = 'new';
      process.env.INTERNAL_API_KEY_PREVIOUS = 'old';
      process.env.INTERNAL_API_KEY_PREVIOUS_EXPIRES_AT = iso(Date.now() + HOUR);
      const res = rejection(() =>
        guard.canActivate(ctx({ 'x-internal-key': 'old', 'x-fee-collector-role': 'trader' })),
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(FEE_COLLECTOR_AUTH_ERRORS.WRONG_ROLE);
    });

    it('never echoes the presented key', () => {
      process.env.INTERNAL_API_KEY = 'new';
      const res = rejection(() =>
        guard.canActivate(ctx({ 'x-internal-key': 'super-secret-guess' })),
      );
      expect(JSON.stringify(res.body)).not.toContain('super-secret-guess');
    });
  });

  describe('TestnetRedeployGuard', () => {
    const guard = new TestnetRedeployGuard();

    it('supports rotation of TESTNET_REDEPLOY_AUTH', () => {
      process.env.TESTNET_REDEPLOY_AUTH = 'new';
      process.env.TESTNET_REDEPLOY_AUTH_PREVIOUS = 'old';
      process.env.TESTNET_REDEPLOY_AUTH_PREVIOUS_EXPIRES_AT = iso(Date.now() + HOUR);
      expect(guard.canActivate(ctx({ 'x-internal-key': 'old' }))).toBe(true);
      expect(internalKeyAuthOutcomes.snapshot()['testnet_redeploy:previous']).toBe(1);
    });

    it('still refuses mainnet before checking any key', () => {
      process.env.TESTNET_REDEPLOY_AUTH = 'new';
      const res = rejection(() =>
        guard.canActivate(ctx({ 'x-internal-key': 'new', 'x-stellar-network': 'mainnet' })),
      );
      expect(res.body.code).toBe(TESTNET_REDEPLOY_AUTH_ERRORS.MAINNET_FORBIDDEN);
    });

    it('fails closed when unconfigured', () => {
      expect(rejection(() => guard.canActivate(ctx({ 'x-internal-key': 'x' }))).body.code).toBe(
        TESTNET_REDEPLOY_AUTH_ERRORS.NOT_CONFIGURED,
      );
    });
  });
});
