import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TokensModule } from './tokens.module';
import { PrismaService } from '../prisma/prisma.service';
import { IndexerMonitorService } from '../metrics/indexer-monitor.service';
import { DbMetricsService } from '../metrics/db-metrics.service';
import { CacheService } from '../cache/cache.service';
import { STELLAR_CONFIG_KEY } from '../config/stellar.config';

describe('TokensModule', () => {
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
        TokensModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
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
});
