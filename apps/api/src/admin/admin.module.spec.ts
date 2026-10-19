import {
  Global,
  INestApplication,
  Module,
  RequestMethod,
  Type,
} from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, ModulesContainer } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminModule } from './admin.module';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { AdminAuditService } from './admin-audit.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsScheduler } from './analytics.scheduler';
import { InternalKeyGuard } from './internal-key.guard';
import { CacheService } from '../cache/cache.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Audit coverage for AdminModule (#1215).
 *
 * Every privileged controller registered in AdminModule must be audited by
 * AdminAuditInterceptor through its single APP_INTERCEPTOR binding. Adding a
 * controller to AdminModule requires adding it here too, and the HTTP check
 * below then proves each of its routes is audited exactly once.
 */
const EXPECTED_ADMIN_CONTROLLERS: Type<unknown>[] = [AnalyticsController];

/**
 * Stands in for PrismaModule (which pulls in MetricsModule and the Stellar
 * config) so AdminModule compiles in isolation with no DB or Redis.
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    {
      provide: CacheService,
      useValue: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      },
    },
    { provide: ConfigService, useValue: new ConfigService({}) },
  ],
  exports: [PrismaService, CacheService, ConfigService],
})
class AdminTestDependenciesModule {}

const moduleMetadata = <T>(key: string): T[] =>
  (Reflect.getMetadata(key, AdminModule) as T[] | undefined) ?? [];

const adminControllers = (): Type<unknown>[] =>
  moduleMetadata<Type<unknown>>(MODULE_METADATA.CONTROLLERS);

interface ControllerRoute {
  method: string;
  path: string;
}

/** Lists every HTTP route a controller exposes, with `:params` filled in. */
const routesOf = (controller: Type<unknown>): ControllerRoute[] => {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => prototype[name])
    .filter(
      (handler): handler is object =>
        typeof handler === 'function' &&
        Reflect.hasMetadata(PATH_METADATA, handler),
    )
    .map((handler) => {
      const method = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      ) as RequestMethod;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const path = `/${[base, sub]
        .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
        .filter((segment) => segment.length > 0)
        .join('/')}`.replace(/:[^/]+/g, 'test-id');
      return { method: RequestMethod[method], path };
    });
};

describe('AdminModule audit coverage', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AdminModule] })
      .overrideModule(PrismaModule)
      .useModule(AdminTestDependenciesModule)
      // The scheduler opens a BullMQ queue on init; it is not under test.
      .overrideProvider(AnalyticsScheduler)
      .useValue({})
      .overrideGuard(InternalKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('APP_INTERCEPTOR binding', () => {
    it('declares exactly one APP_INTERCEPTOR, aliased to AdminAuditInterceptor', () => {
      const bindings = moduleMetadata<{
        provide?: unknown;
        useExisting?: unknown;
      }>(MODULE_METADATA.PROVIDERS).filter(
        (provider) => provider?.provide === APP_INTERCEPTOR,
      );

      expect(bindings).toHaveLength(1);
      expect(bindings[0].useExisting).toBe(AdminAuditInterceptor);
    });

    it('resolves the APP_INTERCEPTOR binding to the AdminAuditInterceptor singleton', () => {
      const adminModule = [...moduleRef.get(ModulesContainer).values()].find(
        (wrapper) => wrapper.metatype === AdminModule,
      );
      expect(adminModule).toBeDefined();

      // Nest re-keys APP_* providers as `APP_INTERCEPTOR (UUID: ...)`.
      const resolved = [...adminModule!.providers.entries()]
        .filter(([token]) => String(token).startsWith(APP_INTERCEPTOR))
        .map(([, wrapper]) => wrapper.instance);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBeInstanceOf(AdminAuditInterceptor);
      expect(resolved[0]).toBe(moduleRef.get(AdminAuditInterceptor));
    });
  });

  describe('controllers', () => {
    it('registers exactly the expected admin controllers', () => {
      expect(new Set(adminControllers())).toEqual(
        new Set(EXPECTED_ADMIN_CONTROLLERS),
      );
    });

    it.each(EXPECTED_ADMIN_CONTROLLERS.map((c) => [c.name, c] as const))(
      'resolves %s from the compiled module',
      (_name, controller) => {
        expect(moduleRef.get(controller)).toBeInstanceOf(controller);
      },
    );

    it('audits every route of every admin controller exactly once', async () => {
      const auditService = moduleRef.get(AdminAuditService);
      const log = jest.spyOn(auditService, 'log').mockResolvedValue(undefined);

      const routes = adminControllers().flatMap(routesOf);
      expect(routes.length).toBeGreaterThan(0);

      for (const route of routes) {
        log.mockClear();
        const agent = request(app.getHttpServer());
        const method = route.method.toLowerCase() as 'get';
        // Handlers may fail against the stubbed dependencies; failed calls
        // must be audited too, so only the audit record is asserted.
        await agent[method](route.path);

        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: `${route.method} ${route.path}`,
          }),
        );
      }

      log.mockRestore();
    });
  });

  describe('exports', () => {
    it('exports AdminAuditService', () => {
      expect(moduleMetadata(MODULE_METADATA.EXPORTS)).toContain(
        AdminAuditService,
      );
    });

    it('makes AdminAuditService injectable by modules that import AdminModule', () => {
      const adminModule = [...moduleRef.get(ModulesContainer).values()].find(
        (wrapper) => wrapper.metatype === AdminModule,
      );
      expect(adminModule!.exports.has(AdminAuditService)).toBe(true);
      expect(moduleRef.get(AdminAuditService)).toBeInstanceOf(
        AdminAuditService,
      );
    });
  });
});
