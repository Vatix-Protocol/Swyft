/**
 * #1027 — pool-updates WebSocket authn policy. Unit tests for the policy and
 * an integration pass over a real `ws` server/client pair.
 */
import { createServer, IncomingMessage, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { sign } from 'jsonwebtoken';
import { Server, WebSocket } from 'ws';
import { PriceGateway } from './price.gateway';
import {
  authenticateWsHandshake,
  isActionAllowed,
  isValidPoolId,
  resolveWsAuthPolicy,
  WS_CLOSE_UNAUTHORIZED,
  WS_ERROR_CODES,
  WsAuthPolicy,
  wsPoolUpdatesAuthOutcomes,
} from './ws-auth-policy';

const SECRET = 'ws-test-secret';
const WALLET = 'GAWALLETADDRESS';

function handshake(url: string, headers: Record<string, string> = {}) {
  return { url, headers } as unknown as IncomingMessage;
}

function token(
  payload: object = { sub: WALLET, walletAddress: WALLET },
  opts: object = {},
) {
  return sign(payload, SECRET, { algorithm: 'HS256', ...opts });
}

const REQUIRED: WsAuthPolicy = {
  mode: 'required',
  maxSubscriptions: 50,
  anonymousMaxSubscriptions: 10,
};
const OPTIONAL: WsAuthPolicy = { ...REQUIRED, mode: 'optional' };
const ENV = { JWT_SECRET: SECRET };

describe('resolveWsAuthPolicy', () => {
  it('defaults to required', () => {
    expect(resolveWsAuthPolicy({})).toEqual({
      mode: 'required',
      maxSubscriptions: 50,
      anonymousMaxSubscriptions: 10,
    });
  });

  it('accepts optional on testnet', () => {
    expect(
      resolveWsAuthPolicy({
        WS_POOL_UPDATES_AUTH_MODE: 'Optional',
        STELLAR_NETWORK: 'testnet',
      }).mode,
    ).toBe('optional');
  });

  it('fails closed to required on an unknown mode', () => {
    const policy = resolveWsAuthPolicy({ WS_POOL_UPDATES_AUTH_MODE: 'off' });
    expect(policy.mode).toBe('required');
    expect(policy.downgradeReason).toBe('invalid_mode');
  });

  it('refuses optional on mainnet without the explicit opt-in', () => {
    const policy = resolveWsAuthPolicy({
      WS_POOL_UPDATES_AUTH_MODE: 'optional',
      STELLAR_NETWORK: 'mainnet',
    });
    expect(policy.mode).toBe('required');
    expect(policy.downgradeReason).toBe('mainnet_not_enabled');

    expect(
      resolveWsAuthPolicy({
        WS_POOL_UPDATES_AUTH_MODE: 'optional',
        STELLAR_NETWORK: 'mainnet',
        WS_POOL_UPDATES_ANON_MAINNET_ENABLED: 'true',
      }).mode,
    ).toBe('optional');
  });

  it('never gives anonymous clients a higher cap than wallets', () => {
    const policy = resolveWsAuthPolicy({
      PRICE_WS_MAX_SUBSCRIPTIONS_PER_CLIENT: '5',
      WS_POOL_UPDATES_ANON_MAX_SUBSCRIPTIONS: '100',
    });
    expect(policy.anonymousMaxSubscriptions).toBe(5);
  });
});

describe('authenticateWsHandshake', () => {
  it('rejects a missing token in required mode', () => {
    const result = authenticateWsHandshake(handshake('/price'), REQUIRED, ENV);
    expect(result).toMatchObject({
      ok: false,
      code: WS_ERROR_CODES.AUTH_REQUIRED,
    });
  });

  it('allows an anonymous read session in optional mode', () => {
    const result = authenticateWsHandshake(handshake('/price'), OPTIONAL, ENV);
    expect(result).toMatchObject({
      ok: true,
      principal: { kind: 'anonymous' },
    });
  });

  it('authenticates a valid wallet token', () => {
    const result = authenticateWsHandshake(
      handshake(`/price?token=${token()}`),
      REQUIRED,
      ENV,
    );
    expect(result).toMatchObject({
      ok: true,
      principal: { kind: 'wallet', walletAddress: WALLET },
    });
  });

  it.each([OPTIONAL, REQUIRED])(
    'rejects an expired token with WS_AUTH_EXPIRED (mode=%j)',
    (policy) => {
      const expired = token({
        sub: WALLET,
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      const result = authenticateWsHandshake(
        handshake(`/price?token=${expired}`),
        policy,
        ENV,
      );
      expect(result).toMatchObject({
        ok: false,
        code: WS_ERROR_CODES.AUTH_EXPIRED,
      });
    },
  );

  it.each([
    ['garbage', 'not-a-jwt'],
    ['wrong secret', sign({ sub: WALLET }, 'other-secret')],
    ['alg none', sign({ sub: WALLET }, '', { algorithm: 'none' })],
    ['no wallet claim', sign({ foo: 1 }, SECRET)],
  ])(
    'never downgrades a bad token (%s) to anonymous in optional mode',
    (_label, bad) => {
      const result = authenticateWsHandshake(
        handshake(`/price?token=${bad}`),
        OPTIONAL,
        ENV,
      );
      expect(result).toMatchObject({
        ok: false,
        code: WS_ERROR_CODES.AUTH_INVALID,
      });
    },
  );

  it('rejects a presented token when JWT_SECRET is unset', () => {
    const result = authenticateWsHandshake(
      handshake(`/price?token=${token()}`),
      OPTIONAL,
      {},
    );
    expect(result).toMatchObject({
      ok: false,
      code: WS_ERROR_CODES.AUTH_INVALID,
    });
  });

  it('enforces issuer/audience when configured', () => {
    const result = authenticateWsHandshake(
      handshake(`/price?token=${token()}`),
      REQUIRED,
      { ...ENV, JWT_AUDIENCE: 'swyft-client' },
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('echoes a safe client correlation id and replaces unsafe ones', () => {
    const ok = authenticateWsHandshake(
      handshake('/price', { 'x-correlation-id': 'corr-123' }),
      REQUIRED,
      ENV,
    );
    expect(ok.correlationId).toBe('corr-123');

    const forged = authenticateWsHandshake(
      handshake('/price', { 'x-correlation-id': 'a\nforged' }),
      REQUIRED,
      ENV,
    );
    expect(forged.correlationId).not.toContain('\n');
  });
});

describe('action and input policy', () => {
  it('limits anonymous sessions to read-only actions', () => {
    const anon = { kind: 'anonymous' } as const;
    const wallet = { kind: 'wallet', walletAddress: WALLET } as const;
    expect(isActionAllowed(anon, 'subscribe')).toBe(true);
    expect(isActionAllowed(anon, 'unsubscribe')).toBe(true);
    expect(isActionAllowed(anon, 'swap')).toBe(false);
    expect(isActionAllowed(wallet, 'swap')).toBe(true);
  });

  it.each([
    ['CABC123', true],
    ['pool-1', true],
    ['', false],
    ['x'.repeat(129), false],
    ['pool\nforged', false],
    [42, false],
    [{ $ne: null }, false],
  ])('isValidPoolId(%j) → %s', (value, expected) => {
    expect(isValidPoolId(value)).toBe(expected);
  });
});

// ── Integration: real ws server + client ──────────────────────────────────────

describe('PriceGateway over a real WebSocket', () => {
  const ENV_KEYS = [
    'JWT_SECRET',
    'JWT_ISSUER',
    'JWT_AUDIENCE',
    'WS_POOL_UPDATES_AUTH_MODE',
    'WS_POOL_UPDATES_ANON_MAX_SUBSCRIPTIONS',
    'WS_POOL_UPDATES_ANON_MAINNET_ENABLED',
    'PRICE_WS_MAX_SUBSCRIPTIONS_PER_CLIENT',
    'STELLAR_NETWORK',
  ];
  const saved: Record<string, string | undefined> = {};

  let http: HttpServer;
  let wss: Server;
  let port: number;
  const subs = new Map<WebSocket, Set<string>>();
  const priceService = {
    subscribe: jest.fn((c: WebSocket, p: string) => {
      if (!subs.has(c)) subs.set(c, new Set());
      subs.get(c)!.add(p);
    }),
    unsubscribe: jest.fn((c: WebSocket, p: string) => subs.get(c)?.delete(p)),
    getSubscriptionCount: jest.fn((c: WebSocket) => subs.get(c)?.size ?? 0),
    removeClient: jest.fn((c: WebSocket) => subs.delete(c)),
    invalidatePairCache: jest.fn().mockResolvedValue(undefined),
  };

  async function start(env: Record<string, string>) {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, { JWT_SECRET: SECRET }, env);
    http = createServer();
    wss = new Server({ server: http, path: '/price' });
    new PriceGateway(priceService as never).afterInit(wss);
    await new Promise<void>((r) => http.listen(0, r));
    port = (http.address() as AddressInfo).port;
  }

  interface Session {
    ws: WebSocket;
    next: () => Promise<Record<string, unknown>>;
    closed: Promise<number>;
  }

  function connect(query = ''): Promise<Session> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/price${query}`, {
      headers: { 'x-correlation-id': 'corr-ws' },
    });
    const inbox: Record<string, unknown>[] = [];
    const waiters: ((m: Record<string, unknown>) => void)[] = [];
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else inbox.push(msg);
    });
    const closed = new Promise<number>((r) =>
      ws.on('close', (code) => r(code)),
    );
    const next = () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const queued = inbox.shift();
        if (queued) resolve(queued);
        else waiters.push(resolve);
      });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve({ ws, next, closed }));
      ws.once('error', reject);
    });
  }

  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    subs.clear();
    wsPoolUpdatesAuthOutcomes.reset();
  });

  afterEach(async () => {
    for (const c of wss?.clients ?? []) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('required mode: closes an anonymous client with 4401 + stable code', async () => {
    await start({});
    const s = await connect();
    const err = await s.next();
    expect(err).toMatchObject({
      event: 'error',
      code: WS_ERROR_CODES.AUTH_REQUIRED,
      correlationId: 'corr-ws',
    });
    expect(await s.closed).toBe(WS_CLOSE_UNAUTHORIZED);
    expect(wsPoolUpdatesAuthOutcomes.snapshot().rejected_auth_required).toBe(1);
  });

  it('required mode: a wallet can subscribe and trigger swap invalidation', async () => {
    await start({});
    const s = await connect(`?token=${token()}`);
    s.ws.send(JSON.stringify({ action: 'subscribe', poolId: 'pool-1' }));
    expect(await s.next()).toEqual({ event: 'subscribed', poolId: 'pool-1' });
    s.ws.send(
      JSON.stringify({
        action: 'swap',
        poolId: 'pool-1',
        tokenA: 'A',
        tokenB: 'B',
      }),
    );
    s.ws.send(JSON.stringify({ action: 'unsubscribe', poolId: 'pool-1' }));
    expect(await s.next()).toEqual({ event: 'unsubscribed', poolId: 'pool-1' });
    expect(priceService.invalidatePairCache).toHaveBeenCalledWith('A', 'B');
    s.ws.close();
  });

  it('optional mode: anonymous clients can read pool updates', async () => {
    await start({ WS_POOL_UPDATES_AUTH_MODE: 'optional' });
    const s = await connect();
    s.ws.send(JSON.stringify({ action: 'subscribe', poolId: 'pool-1' }));
    expect(await s.next()).toEqual({ event: 'subscribed', poolId: 'pool-1' });
    expect(wsPoolUpdatesAuthOutcomes.snapshot().connected_anonymous).toBe(1);
    s.ws.close();
  });

  it('optional mode: anonymous clients cannot trigger side effects', async () => {
    await start({ WS_POOL_UPDATES_AUTH_MODE: 'optional' });
    const s = await connect();
    s.ws.send(
      JSON.stringify({
        action: 'swap',
        poolId: 'pool-1',
        tokenA: 'A',
        tokenB: 'B',
      }),
    );
    expect(await s.next()).toMatchObject({
      event: 'error',
      code: WS_ERROR_CODES.FORBIDDEN,
      correlationId: 'corr-ws',
    });
    expect(priceService.invalidatePairCache).not.toHaveBeenCalled();
    s.ws.close();
  });

  it('optional mode: an expired token is rejected, not downgraded', async () => {
    await start({ WS_POOL_UPDATES_AUTH_MODE: 'optional' });
    const expired = token({
      sub: WALLET,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const s = await connect(`?token=${expired}`);
    expect(await s.next()).toMatchObject({ code: WS_ERROR_CODES.AUTH_EXPIRED });
    expect(await s.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it('optional mode: anonymous clients get the lower subscription cap', async () => {
    await start({
      WS_POOL_UPDATES_AUTH_MODE: 'optional',
      WS_POOL_UPDATES_ANON_MAX_SUBSCRIPTIONS: '2',
    });
    const s = await connect();
    for (const poolId of ['p1', 'p2']) {
      s.ws.send(JSON.stringify({ action: 'subscribe', poolId }));
      expect(await s.next()).toEqual({ event: 'subscribed', poolId });
    }
    s.ws.send(JSON.stringify({ action: 'subscribe', poolId: 'p3' }));
    expect(await s.next()).toMatchObject({
      code: WS_ERROR_CODES.SUBSCRIPTION_LIMIT,
      poolId: 'p3',
    });
    s.ws.close();
  });

  it('resubscribing to the same pool is idempotent', async () => {
    await start({});
    const s = await connect(`?token=${token()}`);
    for (let i = 0; i < 3; i++) {
      s.ws.send(JSON.stringify({ action: 'subscribe', poolId: 'pool-1' }));
      await s.next();
    }
    expect(subs.get([...subs.keys()][0])?.size).toBe(1);
    s.ws.close();
  });

  it('mainnet without opt-in stays in required mode', async () => {
    await start({
      WS_POOL_UPDATES_AUTH_MODE: 'optional',
      STELLAR_NETWORK: 'mainnet',
    });
    const s = await connect();
    expect(await s.next()).toMatchObject({
      code: WS_ERROR_CODES.AUTH_REQUIRED,
    });
    expect(await s.closed).toBe(WS_CLOSE_UNAUTHORIZED);
  });

  it('rejects adversarial poolIds with WS_INVALID_REQUEST', async () => {
    await start({ WS_POOL_UPDATES_AUTH_MODE: 'optional' });
    const s = await connect();
    s.ws.send(JSON.stringify({ action: 'subscribe', poolId: 'x'.repeat(500) }));
    expect(await s.next()).toMatchObject({
      code: WS_ERROR_CODES.INVALID_REQUEST,
    });
    expect(priceService.subscribe).not.toHaveBeenCalled();
    s.ws.close();
  });
});
