import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'test-secret';
const WALLET = 'GTEST_WALLET_ADDRESS';

function makeContext(token: string | undefined): ExecutionContext {
  const req: Record<string, unknown> = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function issueToken(
  payload: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; secret?: string } = {},
) {
  return sign(payload, opts.secret ?? SECRET, {
    expiresIn: '1h',
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
    ...(opts.audience ? { audience: opts.audience } : {}),
  });
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const originalEnv = process.env;

  beforeEach(() => {
    guard = new JwtAuthGuard();
    process.env = { ...originalEnv, JWT_SECRET: SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts a valid token without issuer/audience configured', () => {
    const token = issueToken({ sub: WALLET, walletAddress: WALLET });
    const ctx = makeContext(token);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws when Authorization header is missing', () => {
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  // ── Issuer validation ──────────────────────────────────────────────────────

  describe('issuer validation', () => {
    beforeEach(() => {
      process.env.JWT_ISSUER = 'swyft-api';
    });

    it('accepts a token with the correct issuer', () => {
      const token = issueToken(
        { sub: WALLET, walletAddress: WALLET },
        { issuer: 'swyft-api' },
      );
      expect(guard.canActivate(makeContext(token))).toBe(true);
    });

    it('rejects a token with a wrong issuer', () => {
      const token = issueToken(
        { sub: WALLET, walletAddress: WALLET },
        { issuer: 'other-service' },
      );
      expect(() => guard.canActivate(makeContext(token))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with no issuer claim when issuer is required', () => {
      const token = issueToken({ sub: WALLET, walletAddress: WALLET });
      expect(() => guard.canActivate(makeContext(token))).toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── Audience validation ────────────────────────────────────────────────────

  describe('audience validation', () => {
    beforeEach(() => {
      process.env.JWT_AUDIENCE = 'swyft-client';
    });

    it('accepts a token with the correct audience', () => {
      const token = issueToken(
        { sub: WALLET, walletAddress: WALLET },
        { audience: 'swyft-client' },
      );
      expect(guard.canActivate(makeContext(token))).toBe(true);
    });

    it('rejects a token with a wrong audience', () => {
      const token = issueToken(
        { sub: WALLET, walletAddress: WALLET },
        { audience: 'other-client' },
      );
      expect(() => guard.canActivate(makeContext(token))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with no audience claim when audience is required', () => {
      const token = issueToken({ sub: WALLET, walletAddress: WALLET });
      expect(() => guard.canActivate(makeContext(token))).toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── Issuer + audience together ─────────────────────────────────────────────

  it('accepts a token that satisfies both issuer and audience', () => {
    process.env.JWT_ISSUER = 'swyft-api';
    process.env.JWT_AUDIENCE = 'swyft-client';

    const token = issueToken(
      { sub: WALLET, walletAddress: WALLET },
      { issuer: 'swyft-api', audience: 'swyft-client' },
    );
    expect(guard.canActivate(makeContext(token))).toBe(true);
  });
});
