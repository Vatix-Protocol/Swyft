import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';

// Stub BullMQ / IORedis before AppModule loads so workers do not open real
// Redis connections that keep Jest from exiting.
const noop = jest.fn().mockResolvedValue(undefined);
const queueMock = {
  add: jest.fn().mockResolvedValue({ id: '1' }),
  close: jest.fn().mockResolvedValue(undefined),
  upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
  getJobs: jest.fn().mockResolvedValue([]),
};

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
  ping: jest.fn().mockResolvedValue('PONG'),
  duplicate: jest.fn(),
};
redisMock.duplicate.mockReturnValue(redisMock);

jest.mock('ioredis', () => jest.fn().mockImplementation(() => redisMock));

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/request-validation/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { CacheService } from './../src/cache/cache.service';
import { REDIS_CLIENT } from './../src/redis/redis.constants';
import { HorizonService } from './../src/horizon/horizon.service';

const prismaMock = {
  $connect: noop,
  $disconnect: noop,
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  pool: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
  },
  token: { findMany: jest.fn().mockResolvedValue([]) },
  swap: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  position: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  tick: { findMany: jest.fn().mockResolvedValue([]) },
  webhook: {
    findMany: jest.fn().mockResolvedValue([]),
    create: noop,
    deleteMany: noop,
  },
  apiKey: { findUnique: jest.fn().mockResolvedValue(null) },
  priceCandle: { findMany: jest.fn().mockResolvedValue([]) },
  indexerCursor: { findUnique: jest.fn().mockResolvedValue(null) },
  poolCreated: { findMany: jest.fn().mockResolvedValue([]) },
  swapProcessed: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
};

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
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
      .overrideProvider(HorizonService)
      .useValue({
        onModuleInit: noop,
        onModuleDestroy: noop,
      })
      .compile();

    app = moduleFixture.createNestApplication();

    // Mirrors the WebSocket + global filter wiring in src/main.ts so the e2e
    // suite exercises the same app bootstrap used in production.
    app.useWebSocketAdapter(new WsAdapter(app));
    const httpAdapterHost = app.get(HttpAdapterHost);
    app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('global exception filter wiring', () => {
    it('returns the consistent error shape for an unknown route (404)', async () => {
      const res = await request(app.getHttpServer())
        .get('/this-route-does-not-exist')
        .expect(404);

      expect(res.body).toMatchObject({
        statusCode: 404,
        error: expect.any(String),
        path: '/this-route-does-not-exist',
      });
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
      expect(typeof res.body.timestamp).toBe('string');
    });
  });
});
