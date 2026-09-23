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

  describe('health', () => {
    it('returns 200 when all checks pass', async () => {
      const res = mockResponse();
      const result = await appController.health(res);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result.status).toBe('ok');
    });

    it('returns 503 when a dependency is degraded', async () => {
      const degradedController = await buildController(
        jest.fn().mockRejectedValue(new Error('db down')),
        jest.fn().mockResolvedValue(true),
      );
      const res = mockResponse();
      const result = await degradedController.health(res);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(result.status).toBe('degraded');
    });
  });
});
