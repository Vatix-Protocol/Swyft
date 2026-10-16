import { Controller, Get, INestApplication, Query } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { ErrorResponse } from './error-response.interface';
import { PaginationQueryDto } from './index';

@Controller('validation-envelope')
class ValidationEnvelopeController {
  @Get()
  find(@Query() query: PaginationQueryDto): PaginationQueryDto {
    return query;
  }
}

describe('validation envelope (pipe + filter)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationEnvelopeController],
      providers: [
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({ whitelist: true }),
        },
        {
          provide: APP_FILTER,
          useClass: AllExceptionsFilter,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('surfaces an out-of-range limit through the filter as an ErrorResponse', async () => {
    const response = await request(app.getHttpServer())
      .get('/validation-envelope')
      .query({ limit: 1000 });

    expect(response.status).toBe(400);

    const body = response.body as ErrorResponse;

    expect(body.statusCode).toBe(400);
    expect(typeof body.message).toBe('string');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toEqual(
      expect.objectContaining({
        field: 'limit',
        messages: expect.any(Array),
      }),
    );
    expect(body.errors[0].messages.length).toBeGreaterThan(0);
  });
});
