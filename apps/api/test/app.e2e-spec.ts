import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/request-validation/all-exceptions.filter';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirrors the global filter registration in src/main.ts so the e2e
    // suite exercises the same error-handling wiring used in production.
    const httpAdapterHost = app.get(HttpAdapterHost);
    app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

    await app.init();
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
