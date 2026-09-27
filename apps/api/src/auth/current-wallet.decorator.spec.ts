import {
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Keypair } from '@stellar/stellar-sdk';
import { Request } from 'express';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import {
  CurrentWallet,
  CurrentWalletPrincipal,
  currentWalletOutcomes,
  resolveWalletPrincipal,
  WALLET_AUTH_ERROR_CODES,
  AuthenticatedWallet,
} from './current-wallet.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { attachWalletPrincipal } from './wallet-principal';

const WALLET = Keypair.random().publicKey();

function makeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function codeOf(fn: () => unknown): { status: number; code: string; body: any } {
  try {
    fn();
  } catch (err) {
    const e = err as UnauthorizedException | ForbiddenException;
    const body = e.getResponse() as { code: string };
    return { status: e.getStatus(), code: body.code, body };
  }
  throw new Error('expected rejection');
}

describe('resolveWalletPrincipal (#1033 trust boundary)', () => {
  beforeEach(() => currentWalletOutcomes.reset());

  it('returns the principal attached by the guard', () => {
    const req = makeRequest();
    attachWalletPrincipal(req, {
      walletAddress: WALLET,
      roles: ['trader'],
      scopes: ['positions:read'],
      correlationId: 'cid-1',
    });
    const principal = resolveWalletPrincipal(req, undefined);
    expect(principal.walletAddress).toBe(WALLET);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(currentWalletOutcomes.snapshot().allowed).toBe(1);
  });

  it('fails closed when no guard attached a principal', () => {
    const res = codeOf(() =>
      resolveWalletPrincipal(makeRequest({ 'x-correlation-id': 'cid-2' }), undefined),
    );
    expect(res).toMatchObject({
      status: 401,
      code: WALLET_AUTH_ERROR_CODES.MISSING_WALLET,
    });
    expect(res.body.correlationId).toBe('cid-2');
  });

  it.each([
    ['req.user', { user: { walletAddress: WALLET, roles: ['admin'], scopes: [] } }],
    ['req.wallet', { wallet: { wallet: WALLET, scopes: ['*'] } }],
    ['header', { headers: { 'x-wallet-address': WALLET } }],
  ])('ignores client/middleware-controlled %s', (_label, extra) => {
    const req = { headers: {}, ...extra } as unknown as Request;
    expect(codeOf(() => resolveWalletPrincipal(req, undefined)).code).toBe(
      WALLET_AUTH_ERROR_CODES.MISSING_WALLET,
    );
  });

  it.each(['', 'not-a-key', 'GABC', WALLET.toLowerCase(), 'M' + WALLET.slice(1)])(
    'rejects an invalid wallet address %p',
    (address) => {
      const req = makeRequest();
      attachWalletPrincipal(req, {
        walletAddress: address,
        roles: ['trader'],
        scopes: [],
        correlationId: 'cid-3',
      });
      const res = codeOf(() => resolveWalletPrincipal(req, undefined));
      expect(res).toMatchObject({
        status: 401,
        code: WALLET_AUTH_ERROR_CODES.INVALID_WALLET,
      });
      // Never echoes the address back.
      if (address) expect(JSON.stringify(res.body)).not.toContain(address);
    },
  );

  it('enforces every required scope (deny-by-default)', () => {
    const req = makeRequest();
    attachWalletPrincipal(req, {
      walletAddress: WALLET,
      roles: ['trader'],
      scopes: ['positions:read'],
      correlationId: 'cid-4',
    });
    expect(resolveWalletPrincipal(req, { scopes: ['positions:read'] })).toBeTruthy();
    expect(
      codeOf(() =>
        resolveWalletPrincipal(req, { scopes: ['positions:read', 'fees:write'] }),
      ),
    ).toMatchObject({ status: 403, code: WALLET_AUTH_ERROR_CODES.INSUFFICIENT_SCOPE });
  });

  it('enforces the role allow-list (wrong role)', () => {
    const req = makeRequest();
    attachWalletPrincipal(req, {
      walletAddress: WALLET,
      roles: ['trader'],
      scopes: [],
      correlationId: 'cid-5',
    });
    expect(
      codeOf(() => resolveWalletPrincipal(req, { roles: ['admin'] })),
    ).toMatchObject({ status: 403, code: WALLET_AUTH_ERROR_CODES.INSUFFICIENT_ROLE });
    expect(resolveWalletPrincipal(req, { roles: ['admin', 'trader'] })).toBeTruthy();
  });

  it('snapshots principal arrays so later mutation cannot escalate', () => {
    const req = makeRequest();
    const roles = ['trader'];
    attachWalletPrincipal(req, {
      walletAddress: WALLET,
      roles,
      scopes: [],
      correlationId: 'cid-6',
    });
    roles.push('admin');
    expect(
      codeOf(() => resolveWalletPrincipal(req, { roles: ['admin'] })).code,
    ).toBe(WALLET_AUTH_ERROR_CODES.INSUFFICIENT_ROLE);
  });

  it('keeps metric labels bounded under adversarial input', () => {
    for (let i = 0; i < 50; i++) {
      codeOf(() =>
        resolveWalletPrincipal(makeRequest({ 'x-correlation-id': `c${i}` }), undefined),
      );
    }
    const snap = currentWalletOutcomes.snapshot();
    expect(Object.keys(snap)).toHaveLength(6);
    expect(snap[WALLET_AUTH_ERROR_CODES.MISSING_WALLET]).toBe(50);
  });
});

@Controller('probe')
@UseGuards(JwtAuthGuard)
class ProbeController {
  @Get('wallet')
  wallet(@CurrentWallet() wallet: string) {
    return { wallet };
  }

  @Get('admin')
  admin(@CurrentWallet({ roles: ['admin'] }) wallet: string) {
    return { wallet };
  }

  @Get('principal')
  principal(@CurrentWalletPrincipal() principal: AuthenticatedWallet) {
    return principal;
  }
}

@Controller('unguarded')
class UnguardedController {
  @Get()
  wallet(@CurrentWallet() wallet: string) {
    return { wallet };
  }
}

describe('CurrentWallet + JwtAuthGuard (HTTP integration)', () => {
  const SECRET = 'test-secret-for-current-wallet-spec-0123456789';
  const originalSecret = process.env.JWT_SECRET;
  let app: INestApplication;

  const token = (claims: Record<string, unknown>, expiresIn: number | string = '5m') =>
    sign(claims, SECRET, { algorithm: 'HS256', expiresIn } as any);

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController, UnguardedController],
      providers: [JwtAuthGuard],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.JWT_SECRET = originalSecret;
  });

  it('injects the wallet from a verified token as a string', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/wallet')
      .set('Authorization', `Bearer ${token({ sub: WALLET, scope: 'positions:read' })}`)
      .expect(200);
    expect(res.body).toEqual({ wallet: WALLET });
  });

  it('exposes the full principal with the sanitized correlation id', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/principal')
      .set('x-correlation-id', 'trace-123')
      .set('Authorization', `Bearer ${token({ sub: WALLET, role: 'admin' })}`)
      .expect(200);
    expect(res.body).toEqual({
      walletAddress: WALLET,
      roles: ['admin'],
      scopes: [],
      correlationId: 'trace-123',
    });
  });

  it('rejects a wrong role with a stable code', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${token({ sub: WALLET, role: 'fee-collector' })}`)
      .expect(403);
    expect(res.body.code).toBe(WALLET_AUTH_ERROR_CODES.INSUFFICIENT_ROLE);
  });

  it('rejects a token whose wallet claim is not a Stellar key', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/wallet')
      .set('Authorization', `Bearer ${token({ sub: 'robert"); drop', scope: 'positions:read' })}`)
      .expect(401);
    expect(res.body.code).toBe(WALLET_AUTH_ERROR_CODES.INVALID_WALLET);
  });

  it('rejects an expired token before the decorator runs', async () => {
    await request(app.getHttpServer())
      .get('/probe/wallet')
      .set('Authorization', `Bearer ${token({ sub: WALLET, scope: 'positions:read' }, -10)}`)
      .expect(401);
  });

  it('fails closed on a route that forgot the guard', async () => {
    const res = await request(app.getHttpServer())
      .get('/unguarded')
      .set('Authorization', `Bearer ${token({ sub: WALLET, scope: 'positions:read' })}`)
      .expect(401);
    expect(res.body.code).toBe(WALLET_AUTH_ERROR_CODES.MISSING_WALLET);
  });

  it('replaces a log-forging correlation id with a generated one', async () => {
    const res = await request(app.getHttpServer())
      .get('/unguarded')
      .set('x-correlation-id', 'a b\tforged')
      .expect(401);
    expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
