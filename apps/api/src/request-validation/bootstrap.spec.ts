import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../app.setup';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * #1204 — there is exactly one API bootstrap (src/main.ts) and it registers
 * AllExceptionsFilter through configureApp. A parallel bootstrap under
 * request-validation/ (or anywhere else) must not reappear.
 */

const SRC_ROOT = join(__dirname, '..');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

@Controller('bootstrap-probe')
class BootstrapProbeController {
  @Get('boom')
  boom(): never {
    throw new Error('probe failure');
  }
}

describe('API bootstrap', () => {
  describe('configureApp (used by the real bootstrap)', () => {
    let app: INestApplication;
    let useGlobalFiltersSpy: jest.SpyInstance;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [BootstrapProbeController],
      }).compile();

      app = moduleRef.createNestApplication();
      useGlobalFiltersSpy = jest.spyOn(app, 'useGlobalFilters');
      configureApp(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('registers AllExceptionsFilter as a global filter', () => {
      const registered = useGlobalFiltersSpy.mock.calls.flat();
      expect(
        registered.some((filter) => filter instanceof AllExceptionsFilter),
      ).toBe(true);
    });

    it('renders unhandled errors with the AllExceptionsFilter envelope', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/bootstrap-probe/boom',
      );

      expect(res.status).toBe(500);
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          path: '/v1/bootstrap-probe/boom',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('single entrypoint', () => {
    it('main.ts delegates to configureApp', () => {
      const main = readFileSync(join(SRC_ROOT, 'main.ts'), 'utf8');
      expect(main).toMatch(/from '\.\/app\.setup'/);
      expect(main).toMatch(/configureApp\(app\)/);
    });

    it('has no second bootstrap under request-validation/', () => {
      expect(existsSync(join(__dirname, 'main.ts'))).toBe(false);
    });

    it('only src/main.ts creates a Nest application', () => {
      const bootstraps = listSourceFiles(SRC_ROOT)
        .filter((file) =>
          readFileSync(file, 'utf8').includes('NestFactory.create'),
        )
        .map((file) => relative(SRC_ROOT, file));

      expect(bootstraps).toEqual(['main.ts']);
    });
  });
});
