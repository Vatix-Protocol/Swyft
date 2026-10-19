import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from './cache.module';
import { CacheService } from './cache.service';

/** Metadata keys Nest's @Global() / @Module() decorators write. */
const GLOBAL_MODULE_METADATA = '__module:global__';
const EXPORTS_METADATA = 'exports';
const PROVIDERS_METADATA = 'providers';

/**
 * Guards the global export contract of CacheModule: other modules inject
 * CacheService without importing CacheModule, so dropping @Global() or the
 * export must fail here rather than as a DI error in an unrelated module.
 */

@Injectable()
class CacheProbe {
  constructor(@Inject(CacheService) readonly cache: CacheService) {}
}

/** Deliberately does NOT import CacheModule. */
@Module({ providers: [CacheProbe] })
class ProbeModule {}

describe('CacheModule', () => {
  describe('metadata', () => {
    it('is decorated with @Global()', () => {
      expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, CacheModule)).toBe(
        true,
      );
    });

    it('exports CacheService', () => {
      const exportsList: unknown[] =
        Reflect.getMetadata(EXPORTS_METADATA, CacheModule) ?? [];

      expect(exportsList).toContain(CacheService);
    });

    it('provides CacheService', () => {
      const providers: unknown[] =
        Reflect.getMetadata(PROVIDERS_METADATA, CacheModule) ?? [];

      expect(providers).toContain(CacheService);
    });
  });

  describe('global DI resolution', () => {
    let module: TestingModule;
    const cacheStub = { get: jest.fn(), set: jest.fn() };

    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [CacheModule, ProbeModule],
      })
        .overrideProvider(CacheService)
        .useValue(cacheStub)
        .compile();
    });

    afterEach(async () => {
      await module?.close();
    });

    it('injects CacheService into a module that does not import CacheModule', () => {
      const probe = module.get(CacheProbe);

      expect(probe.cache).toBe(cacheStub);
    });
  });
});
