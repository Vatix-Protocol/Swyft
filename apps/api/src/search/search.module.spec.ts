import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SearchModule } from './search.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { IndexerMonitorService } from '../metrics/indexer-monitor.service';
import { DbMetricsService } from '../metrics/db-metrics.service';
import { CacheService } from '../cache/cache.service';
import { STELLAR_CONFIG_KEY } from '../config/stellar.config';
import { createMockPrismaService } from '../pools-unit-test/mock-factories';

describe('SearchModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              [STELLAR_CONFIG_KEY]: {
                rpcUrl: 'https://soroban-testnet.stellar.org',
                horizonUrl: 'https://horizon-testnet.stellar.org',
                network: 'testnet',
                poolContractId: '',
              },
            }),
          ],
        }),
        SearchModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(createMockPrismaService())
      .overrideProvider(IndexerMonitorService)
      .useValue({ onModuleInit: () => {}, onModuleDestroy: () => {} })
      .overrideProvider(DbMetricsService)
      .useValue({})
      .overrideProvider(CacheService)
      .useValue({ get: jest.fn(), set: jest.fn() })
      .compile();
  });

  afterEach(async () => {
    await module?.close();
  });

  it('compiles without errors', () => {
    expect(module).toBeDefined();
  });

  it('resolves SearchController, SearchService, and ApiKeyGuard', () => {
    expect(module.get(SearchController)).toBeDefined();
    expect(module.get(SearchService)).toBeDefined();
    expect(module.get(ApiKeyGuard)).toBeDefined();
  });
});
