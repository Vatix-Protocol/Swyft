import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheService } from './cache/cache.service';
import { PrismaService } from './prisma/prisma.service';

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
  } as unknown as import('express').Response;
}

describe('AppController', () => {
  let appController: AppController;

  async function buildController(
    queryRaw: jest.Mock,
    ping: jest.Mock,
  ): Promise<AppController> {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        { provide: CacheService, useValue: { ping } },
      ],
    }).compile();

    return app.get<AppController>(AppController);
  }

  beforeEach(async () => {
    appController = await buildController(
      jest.fn().mockResolvedValue([{ ok: 1 }]),
      jest.fn().mockResolvedValue(true),
    );
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('liveness (/health)', () => {
    it('returns 200 without touching dependencies', async () => {
      const queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
      const ping = jest.fn().mockRejectedValue(new Error('redis down'));
      const controller = await buildController(queryRaw, ping);

      const res = mockResponse();
      const result = await controller.health(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result.status).toBe('ok');
      expect(queryRaw).not.toHaveBeenCalled();
      expect(ping).not.toHaveBeenCalled();
    });
  });

  describe('readiness (/health/ready)', () => {
    it('returns 200 and ready when all dependencies are available', async () => {
      const res = mockResponse();
      const result = await appController.ready(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result.status).toBe('ready');
      expect(result.checks).toEqual({ db: 'up', cache: 'up' });
    });

    it('fails closed with 503 and a stable error code when the DB is unavailable', async () => {
      const controller = await buildController(
        jest.fn().mockRejectedValue(new Error('db down')),
        jest.fn().mockResolvedValue(true),
      );
      const res = mockResponse();
      const result = await controller.ready(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(result.status).toBe('degraded');
      expect(result.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(result.checks).toEqual({ db: 'down', cache: 'up' });
    });

    it('fails closed with 503 and a stable error code when the cache is unavailable', async () => {
      const controller = await buildController(
        jest.fn().mockResolvedValue([{ ok: 1 }]),
        jest.fn().mockRejectedValue(new Error('redis down')),
      );
      const res = mockResponse();
      const result = await controller.ready(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(result.status).toBe('degraded');
      expect(result.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(result.checks).toEqual({ db: 'up', cache: 'down' });
    });

    it('never leaks secrets, connection strings, or internal hostnames', async () => {
      const controller = await buildController(
        jest
          .fn()
          .mockRejectedValue(
            new Error('postgres://user:secret@internal-db:5432/swyft'),
          ),
        jest.fn().mockResolvedValue(true),
      );
      const res = mockResponse();
      const result = await controller.ready(res);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('internal-db');
      expect(serialized).not.toContain('postgres://');
    });
  });
});
