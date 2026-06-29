/**
 * #407 — AppModule smoke test: all public (unauthenticated) routes return 200.
 *
 * The entire module graph is bootstrapped but every external dependency
 * (Prisma, Redis, BullMQ, Horizon, JWT) is replaced with lightweight stubs so
 * the test runs without a live database or message broker.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
  pool: { findMany: emptyList, findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
  token: { findMany: emptyList },
  swap: { findMany: emptyList, count: jest.fn().mockResolvedValue(0) },
  position: { findMany: emptyList, count: jest.fn().mockResolvedValue(0) },
  tick: { findMany: emptyList },
  webhook: { findMany: emptyList, create: noop, deleteMany: noop },
  apiKey: { findUnique: jest.fn().mockResolvedValue(null) },
  priceCandle: { findMany: emptyList },
  indexerCursor: { findUnique: jest.fn().mockResolvedValue(null) },
  poolCreated: { findMany: emptyList },
  swapProcessed: { findMany: emptyList },
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
  quit: jest.fn().mockResolvedValue(undefined),
  duplicate: jest.fn(),
};
redisMock.duplicate.mockReturnValue(redisMock);

// BullMQ Queue stub
const queueMock = { add: jest.fn().mockResolvedValue({ id: '1' }), close: jest.fn().mockResolvedValue(undefined) };

// BullMQ Worker / QueueEvents stubs (prevents real Redis connection in IndexerWorker)
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn().mockResolvedValue(undefined), client: Promise.resolve({ llen: jest.fn().mockResolvedValue(0) }) })),
  Queue: jest.fn().mockImplementation(() => queueMock),
  QueueEvents: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) })),
  Job: jest.fn(),
}));

// Prisma client stub
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn().mockImplementation(() => prismaMock) }));

// IORedis stub
jest.mock('ioredis', () => jest.fn().mockImplementation(() => redisMock));

// ── Module imports (after mocks) ──────────────────────────────────────────────

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './cache/cache.service';
import { REDIS_CLIENT } from './redis/redis.constants';

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
        setMaxNumber: jest.fn().mockResolvedValue(true),
        subscribe: jest.fn(),
      })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisMock)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns 200', () =>
    request(app.getHttpServer()).get('/').expect(200));

  it('GET /health returns 200', () =>
    request(app.getHttpServer()).get('/health').expect(200));

  it('GET /pools returns 200', () =>
    request(app.getHttpServer()).get('/pools').expect(200));

  it('GET /swaps returns 200', () =>
    request(app.getHttpServer()).get('/swaps').expect(200));

  it('GET /tokens returns 200', () =>
    request(app.getHttpServer()).get('/tokens').expect(200));

  it('GET /search returns 200', () =>
    request(app.getHttpServer()).get('/search').expect(200));

  it('GET /indexer/status returns 200', () =>
    request(app.getHttpServer()).get('/indexer/status').expect(200));

  it('POST /auth/nonce returns 200 (no body)', () =>
    request(app.getHttpServer()).post('/auth/nonce').expect(200));

  it('GET /docs-json returns the OpenAPI spec', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const doc = res.body as { tags?: { name: string }[]; paths?: Record<string, unknown> };
    const tagNames = (doc.tags ?? []).map((t) => t.name);
    expect(tagNames).toContain('admin');
    const pathKeys = Object.keys(doc.paths ?? {});
    expect(pathKeys.some((p) => p.startsWith('/admin/analytics'))).toBe(true);
  });
});
