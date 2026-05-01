import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { CacheModule } from '../cache/cache.module';
import { PoolsModule } from './pools.module';

describe('Pools Ticks Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PoolsModule, CacheModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /pools/:id/ticks', () => {
    const testPoolId = 'test_pool_123';
    const emptyPoolId = 'empty_pool_123';

    beforeEach(async () => {
      await prisma.tick.deleteMany({ where: { poolId: { in: [testPoolId, emptyPoolId] } } });
      await prisma.poolCreated.deleteMany({ where: { poolId: { in: [testPoolId, emptyPoolId] } } });

      // Seed pool existence records
      await prisma.poolCreated.createMany({
        data: [
          { eventId: `evt_${testPoolId}`, poolId: testPoolId, tokenA: 'USDC', tokenB: 'XLM', fee: '3000', sqrtPriceX96: '0' },
          { eventId: `evt_${emptyPoolId}`, poolId: emptyPoolId, tokenA: 'USDC', tokenB: 'XLM', fee: '3000', sqrtPriceX96: '0' },
        ],
      });

      await prisma.tick.createMany({
        data: [
          { poolId: testPoolId, tickIndex: -276324, liquidityNet: '1000000000000000000', liquidityGross: '1000000000000000000', feeGrowthOutside0X128: '0', feeGrowthOutside1X128: '0' },
          { poolId: testPoolId, tickIndex: -276320, liquidityNet: '500000000000000000', liquidityGross: '1500000000000000000', feeGrowthOutside0X128: '100000000000000000000000000000000000', feeGrowthOutside1X128: '200000000000000000000000000000000000' },
          { poolId: testPoolId, tickIndex: -276316, liquidityNet: '-500000000000000000', liquidityGross: '500000000000000000', feeGrowthOutside0X128: '150000000000000000000000000000000000', feeGrowthOutside1X128: '300000000000000000000000000000000000' },
        ],
      });
    });

    afterEach(async () => {
      await prisma.tick.deleteMany({ where: { poolId: { in: [testPoolId, emptyPoolId] } } });
      await prisma.poolCreated.deleteMany({ where: { poolId: { in: [testPoolId, emptyPoolId] } } });
    });

    it('should return all ticks for a pool', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks`)
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0]).toMatchObject({
        tickIndex: -276324,
        liquidityNet: '1000000000000000000',
        liquidityGross: '1000000000000000000',
        feeGrowthOutside0X128: '0',
        feeGrowthOutside1X128: '0',
      });
    });

    it('should return ticks in ascending order by tickIndex', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks`)
        .expect(200);

      const ticks = response.body;
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i].tickIndex).toBeGreaterThan(ticks[i - 1].tickIndex);
      }
    });

    it('should filter ticks by lowerTick and upperTick', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks?lowerTick=-276322&upperTick=-276318`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].tickIndex).toBe(-276320);
    });

    it('should return empty array for pool with no ticks', async () => {
      const response = await request(app.getHttpServer())
        .get(`/pools/${emptyPoolId}/ticks`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return 404 for unknown pool', async () => {
      const response = await request(app.getHttpServer())
        .get('/pools/unknown_pool/ticks')
        .expect(404);

      expect(response.body.message).toContain('unknown_pool');
    });

    it('should return 400 for invalid tick range', async () => {
      await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks?lowerTick=-276316&upperTick=-276320`)
        .expect(400);
    });

    it('should respond within 100ms (performance requirement)', async () => {
      const startTime = Date.now();
      
      await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks`)
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100);
    });

    it('should cache results for subsequent requests', async () => {
      // First request
      const start1 = Date.now();
      await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks`)
        .expect(200);
      const time1 = Date.now() - start1;

      // Second request (should be cached)
      const start2 = Date.now();
      await request(app.getHttpServer())
        .get(`/pools/${testPoolId}/ticks`)
        .expect(200);
      const time2 = Date.now() - start2;

      // Cached request should be significantly faster
      expect(time2).toBeLessThan(time1 / 2);
    });
  });
});