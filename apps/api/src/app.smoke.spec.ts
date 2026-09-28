/**
 * #407 / #1029 — AppModule smoke test (required CI check: "API smoke").
 *
 * The entire module graph is bootstrapped but every external dependency
 * (Prisma, Redis, BullMQ, Horizon, JWT) is replaced with lightweight stubs so
 * the test runs without a live database or message broker.
 *
 * Invariants (docs/APP_SMOKE.md):
 *  - AppModule boots: every import resolves and every provider wires up.
 *    A missing file or provider fails this suite, and therefore the PR.
 *  - Core public routes answer 200.
 *  - Privileged routes stay deny-by-default. Only ApiKeyGuard (public API
 *    keys) is overridden; internal-key guards run for real, so a privileged
 *    route that loses its guard fails here.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';

// ── Stub helpers ──────────────────────────────────────────────────────────────

const noop = jest.fn().mockResolvedValue(undefined);
const emptyList = jest.fn().mockResolvedValue([]);
const emptyPage = jest.fn().mockResolvedValue({
  items: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  orderBy: 'tvl',
});

// Prisma stub — every model method returns a safe empty value
const prismaMock = {
  $connect: noop,
  $disconnect: noop,
  pool: {
    findMany: emptyList,
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
  },
  token: { findMany: emptyList },
  swap: { findMany: emptyList, count: jest.fn().mockResolvedValue(0) },
  position: { findMany: emptyList, count: jest.fn().mockResolvedValue(0) },
  tick: { findMany: emptyList },
  webhook: { findMany: emptyList, create: noop, deleteMany: noop },
  apiKey: { findUnique: jest.fn().mockResolvedValue(null) },
  priceCandle: { findMany: emptyList },
  indexerCursor: { findUnique: jest.fn().mockResolvedValue(null) },
  poolCreated: { findMany: emptyList },
  swapProcessed: {
    findMany: emptyList,
    findFirst: jest.fn().mockResolvedValue(null),
  },
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
};

// Redis / IORedis stub
const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
  subscribe: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  duplicate: jest.fn(),
};
redisMock.duplicate.mockReturnValue(redisMock);

// BullMQ Queue stub
const queueMock = {
  add: jest.fn().mockResolvedValue({ id: '1' }),
  close: jest.fn().mockResolvedValue(undefined),
  upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
  getJobs: jest.fn().mockResolvedValue([]),
};

// BullMQ Worker / QueueEvents stubs (prevents real Redis connection in IndexerWorker)
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    client: Promise.resolve({ llen: jest.fn().mockResolvedValue(0) }),
  })),
  Queue: jest.fn().mockImplementation(() => queueMock),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Job: jest.fn(),
}));

// Prisma client stub
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => prismaMock),
}));

// IORedis stub
jest.mock('ioredis', () => jest.fn().mockImplementation(() => redisMock));

// ── Module imports (after mocks) ──────────────────────────────────────────────

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './cache/cache.service';
import { REDIS_CLIENT } from './redis/redis.constants';
import { ApiKeyGuard } from './auth/api-key.guard';

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('AppModule — public routes smoke test', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(CacheService)
      .useValue({
        get: jest.fn().mockResolvedValue(null),
        set: noop,
        del: noop,
        publish: noop,
        ping: jest.fn().mockResolvedValue(true),
        setMaxNumber: jest.fn().mockResolvedValue(true),
        subscribe: jest.fn(),
        createSubscriber: jest.fn().mockReturnValue({
          on: jest.fn(),
          subscribe: jest.fn().mockResolvedValue(undefined),
          unsubscribe: jest.fn().mockResolvedValue(undefined),
          quit: jest.fn().mockResolvedValue(undefined),
        }),
      })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisMock)
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('v1', {
      exclude: ['health', 'docs', 'docs-json', '/'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET / returns 200', () =>
    request(app.getHttpServer()).get('/').expect(200));

  it('GET /health returns 200', () =>
    request(app.getHttpServer()).get('/health').expect(200));

  it('GET /v1/pools returns 200', () =>
    request(app.getHttpServer()).get('/v1/pools').expect(200));

  it('GET /v1/swaps returns 200', () =>
    request(app.getHttpServer()).get('/v1/swaps').expect(200));

  it('GET /v1/tokens returns 200', () =>
    request(app.getHttpServer()).get('/v1/tokens').expect(200));

  it('GET /v1/search returns 200', () =>
    request(app.getHttpServer()).get('/v1/search').expect(200));

  it('GET /v1/indexer/status returns 200', () =>
    request(app.getHttpServer()).get('/v1/indexer/status').expect(200));

  it('POST /v1/auth/nonce returns 200 (no body)', () =>
    request(app.getHttpServer()).post('/v1/auth/nonce').expect(200));

  it('unknown routes return 404', () =>
    request(app.getHttpServer()).get('/v1/__smoke_missing__').expect(404));

  // ── Deny-by-default: privileged routes reject callers without a key ───────

  describe('privileged routes without credentials', () => {
    const savedKey = process.env.INTERNAL_API_KEY;

    beforeAll(() => {
      // Configured key, so a 401 proves the guard ran rather than failing
      // closed on missing config.
      process.env.INTERNAL_API_KEY = 'smoke-internal-key-not-sent';
    });

    afterAll(() => {
      if (savedKey === undefined) delete process.env.INTERNAL_API_KEY;
      else process.env.INTERNAL_API_KEY = savedKey;
    });

    it('POST /v1/indexer/dead-letters/replay returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/indexer/dead-letters/replay')
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DLQ_REPLAY_AUTH_MISSING_KEY');
      expect(typeof res.body.correlationId).toBe('string');
    });

    it('POST /v1/indexer/replay returns 401', () =>
      request(app.getHttpServer())
        .post('/v1/indexer/replay')
        .send({ fromLedger: 0 })
        .expect(401));

    it('GET /v1/metrics/security returns 401', () =>
      request(app.getHttpServer()).get('/v1/metrics/security').expect(401));
  });
});
