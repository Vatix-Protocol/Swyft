/**
 * Tests for MetricsController - worker lag and db metrics endpoints.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsModule } from './metrics.module';
import { CacheService } from '../cache/cache.service';
import { IndexerMonitorService } from './indexer-monitor.service';
import { DbMetricsService } from './db-metrics.service';

// ── Mocks ──────────────────────────────────────────────────────────────

const noop = jest.fn().mockResolvedValue(undefined);

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: noop,
    setex: noop,
    del: noop,
    publish: noop,
    connect: noop,
    quit: noop,
  })),
);

// ── Tests ──────────────────────────────────────────────────────────────

describe('MetricsController (smoke)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [MetricsModule],
    })
      .overrideProvider(CacheService)
      .useValue({ get: jest.fn().mockResolvedValue(null), set: noop })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics/worker-lag returns indexer metrics', async () => {
    const result = await request(app.getHttpServer())
      .get('/metrics/worker-lag')
      .expect(200)
      .then((res) => res.body);

    expect(result).toHaveProperty('lastIndexedLedger');
    expect(result).toHaveProperty('latestLedger');
    expect(result).toHaveProperty('lagLedgers');
    expect(result).toHaveProperty('lagSeconds');
    expect(result).toHaveProperty('status');
  });
});