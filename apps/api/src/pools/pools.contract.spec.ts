/**
 * #423 — Contract test: GET /v1/pools list schema
 *
 * Boots the full NestJS application with all external dependencies stubbed
 * (Prisma, Redis, BullMQ) and asserts that GET /v1/pools returns a response
 * whose JSON shape exactly matches the documented contract:
 *
 *   {
 *     items:      Array<PoolListItem>
 *     page:       number
 *     limit:      number
 *     total:      number
 *     totalPages: number
 *     orderBy:    string
 *   }
 *
 * Each PoolListItem must contain: id, token0, token1, feeTier, tvl,
 * volume24h, feeApr, currentPrice.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// ── Stubs ────────────────────────────────────────────────────────────────────

const noop = jest.fn().mockResolvedValue(undefined);
const emptyList = jest.fn().mockResolvedValue([]);

const poolRow = {
  id: 'pool-contract-1',
  token0Address: 'GUSDC000000000000000000000000000000000000000000000000',
  token1Address: 'GXLM0000000000000000000000000000000000000000000000000',
  feeTier: 30,
  currentSqrtPrice: '1.118',
  currentTick: 100,
  liquidity: '500000',
  tvl: '100000',
  volume24h: '5000',
  feeApr: '0.12',
  currentPrice: '1.25',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  swaps: [],
};

const prismaMock = {
  $connect: noop,
  $disconnect: noop,
  pool: {
    findMany: jest.fn().mockResolvedValue([poolRow]),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(1),
    update: noop,
  },
  token: { findMany: emptyList, findUnique: jest.fn().mockResolvedValue(null) },
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

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    client: Promise.resolve({ llen: jest.fn().mockResolvedValue(0) }),
  })),
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: '1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Job: jest.fn(),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => prismaMock),
}));

jest.mock('ioredis', () => jest.fn().mockImplementation(() => redisMock));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GET /v1/pools — contract schema', () => {
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
        invalidate: noop,
        invalidatePattern: noop,
        subscribe: jest.fn(),
      })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisMock)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('v1', { exclude: ['health', 'docs', 'docs-json', '/'] });
    await app.init();
  });

  afterAll(() => app.close());

  it('returns 200 with the documented envelope shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/pools')
      .expect(200);

    // Top-level envelope
    expect(res.body).toMatchObject({
      items: expect.any(Array),
      page: expect.any(Number),
      limit: expect.any(Number),
      total: expect.any(Number),
      totalPages: expect.any(Number),
      orderBy: expect.any(String),
    });
  });

  it('each item in items has the required PoolListItem fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/pools')
      .expect(200);

    for (const item of res.body.items as unknown[]) {
      expect(item).toMatchObject({
        id: expect.any(String),
        token0: expect.any(String),
        token1: expect.any(String),
        feeTier: expect.any(String),
        tvl: expect.any(Number),
        volume24h: expect.any(Number),
        feeApr: expect.any(Number),
        currentPrice: expect.any(Number),
      });
    }
  });

  it('respects the ?search query param without breaking the schema', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/pools?search=USDC')
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('returns an empty items array (not null) when no pools match', async () => {
    prismaMock.pool.findMany.mockResolvedValueOnce([]);

    const res = await request(app.getHttpServer())
      .get('/v1/pools?search=NOMATCH')
      .expect(200);

    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
