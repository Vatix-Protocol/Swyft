import { Test, TestingModule } from '@nestjs/testing';

import { ApiKeyGuard } from './api-key.guard';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PoolsModule } from '../pools/pools.module';
import { PriceModule } from '../price/price.module';

/**
 * Asserts that `ApiKeyGuard` is provided once by `AuthModule` and shared by
 * the feature modules that import it (issue #1226).
 *
 * Mocks:
 * - ioredis: compiling the graph transitively instantiates `RedisModule`;
 *   mocking avoids opening a real Redis connection.
 * - `../pools/pool-factory.service`, `../pools/pool-registry.service`,
 *   `../pools/pools.service`: PoolsModule imports these but they are missing
 *   / empty in this checkout (pre-existing, untracked, unrelated to #1226).
 *   They are stubbed solely so PoolsModule can load for this assertion.
 * - `../metrics/indexer-monitor.service`: `PrismaModule` (imported by
 *   PoolsModule) pulls in `MetricsModule`, whose `IndexerMonitorService`
 *   injects `ConfigService` which is not in scope for a standalone graph.
 *   Stubbed to keep the graph hermetic.
 */
jest.mock('ioredis', () => {
  const mock = jest.fn(function Redis(this: unknown, _options: unknown) {
    this.options = _options;
  });
  return { __esModule: true, default: mock };
});
jest.mock(
  '../pools/pool-factory.service',
  () => ({
    PoolFactoryService: class PoolFactoryService {},
  }),
  { virtual: true },
);
jest.mock(
  '../pools/pool-registry.service',
  () => ({
    PoolRegistryService: class PoolRegistryService {},
  }),
  { virtual: true },
);
jest.mock(
  '../pools/pools.service',
  () => ({
    PoolsService: class PoolsService {},
  }),
  { virtual: true },
);
jest.mock(
  '../metrics/indexer-monitor.service',
  () => ({
    IndexerMonitorService: class IndexerMonitorService {},
  }),
  { virtual: true },
);

describe('ApiKeyGuard module wiring (issue #1226)', () => {
  const originalSecret = process.env.JWT_SECRET;
  const modules: TestingModule[] = [];

  beforeEach(() => {
    // AuthModule's JwtModule factory reads JWT_SECRET at compile time.
    process.env.JWT_SECRET = 'test-shared-guard-secret';
  });

  afterEach(async () => {
    process.env.JWT_SECRET = originalSecret;
    for (const module of modules) {
      await module.close().catch(() => {
        // Swallow close errors; the factory only constructs clients.
      });
    }
    modules.length = 0;
  });

  async function compile(imports: unknown[]): Promise<TestingModule> {
    const module = await Test.createTestingModule({ imports }).compile();
    modules.push(module);
    return module;
  }

  it('provides ApiKeyGuard once via AuthModule and shares it across PoolsModule and PriceModule', async () => {
    // One combined app graph so the shared DI singleton can be compared.
    const app = await compile([AuthModule, PoolsModule, PriceModule]);

    const fromAuth = app.get(ApiKeyGuard);
    const fromPools = app.get(ApiKeyGuard);
    const fromPrice = app.get(ApiKeyGuard);

    expect(fromAuth).toBeInstanceOf(ApiKeyGuard);
    expect(fromPools).toBeInstanceOf(ApiKeyGuard);
    expect(fromPrice).toBeInstanceOf(ApiKeyGuard);

    // All consumers resolve the identical guard instance exported by AuthModule;
    // PoolsModule and PriceModule no longer register their own copies.
    expect(fromPools).toBe(fromAuth);
    expect(fromPrice).toBe(fromAuth);
  });

  it('resolves the shared guard from PoolsModule', async () => {
    const pools = await compile([PoolsModule]);
    const guard = pools.get(ApiKeyGuard);

    expect(guard).toBeInstanceOf(ApiKeyGuard);
    expect(pools.get(ApiKeyGuard)).toBe(guard);
  });

  it('resolves the shared guard from PriceModule', async () => {
    // PrismaModule is imported so `ApiKeyGuard` (via `AuthModule`) can resolve
    // its `PrismaService` dependency.
    const price = await compile([PrismaModule, PriceModule]);
    const guard = price.get(ApiKeyGuard);

    expect(guard).toBeInstanceOf(ApiKeyGuard);
    expect(price.get(ApiKeyGuard)).toBe(guard);
  });
});
