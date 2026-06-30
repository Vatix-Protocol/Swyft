import { Test, TestingModule } from '@nestjs/testing';
import {
  IndexerMonitorService,
  LAST_INDEXED_LEDGER_KEY,
} from './indexer-monitor.service';
import { CacheService } from '../cache/cache.service';

const mockLedgers = {
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  call: jest.fn().mockResolvedValue({ records: [{ sequence: 1000 }] }),
};

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      ledgers: jest.fn().mockReturnValue(mockLedgers),
    })),
  },
}));

describe('IndexerMonitorService', () => {
  let service: IndexerMonitorService;
  let mockCache: jest.Mocked<Pick<CacheService, 'get'>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCache = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerMonitorService,
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<IndexerMonitorService>(IndexerMonitorService);
  });

  afterEach(async () => {
    service.onModuleDestroy();
  });

  describe('getMetrics()', () => {
    it('returns healthy when no checkpoint exists yet (prevents false critical alert)', async () => {
      mockCache.get.mockResolvedValue(null);
      mockLedgers.call.mockResolvedValue({ records: [{ sequence: 5_000_000 }] });

      const metrics = await service.getMetrics();

      expect(metrics.status).toBe('healthy');
      expect(metrics.lagLedgers).toBe(0);
    });

    it('returns healthy when lag is below 10 ledgers', async () => {
      mockCache.get.mockResolvedValue(995);
      mockLedgers.call.mockResolvedValue({ records: [{ sequence: 1000 }] });

      const metrics = await service.getMetrics();

      expect(metrics.status).toBe('healthy');
      expect(metrics.lagLedgers).toBe(5);
    });

    it('returns degraded when lag is between 10 and 50 ledgers', async () => {
      mockCache.get.mockResolvedValue(960);
      mockLedgers.call.mockResolvedValue({ records: [{ sequence: 1000 }] });

      const metrics = await service.getMetrics();

      expect(metrics.status).toBe('degraded');
      expect(metrics.lagLedgers).toBe(40);
    });

    it('returns critical when lag exceeds 50 ledgers', async () => {
      mockCache.get.mockResolvedValue(900);
      mockLedgers.call.mockResolvedValue({ records: [{ sequence: 1000 }] });

      const metrics = await service.getMetrics();

      expect(metrics.status).toBe('critical');
      expect(metrics.lagLedgers).toBe(100);
    });

    it('reports correct lagSeconds based on 5-second ledger close time', async () => {
      mockCache.get.mockResolvedValue(980);
      mockLedgers.call.mockResolvedValue({ records: [{ sequence: 1000 }] });

      const metrics = await service.getMetrics();

      expect(metrics.lagSeconds).toBe(100); // 20 ledgers * 5s
    });

    it('does not return negative lagLedgers when checkpoint is ahead of latest', async () => {
      mockCache.get.mockResolvedValue(1010);
      mockLedgers.call.mockResolvedValue({ records: [{ sequence: 1000 }] });

      const metrics = await service.getMetrics();

      expect(metrics.lagLedgers).toBe(0);
    });

    it('returns lastIndexedLedger = 0 when no checkpoint', async () => {
      mockCache.get.mockResolvedValue(null);

      const metrics = await service.getMetrics();

      expect(metrics.lastIndexedLedger).toBe(0);
    });
  });

  describe('onModuleInit()', () => {
    it('starts the periodic check timer', () => {
      const spy = jest.spyOn(global, 'setInterval');
      service.onModuleInit();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('onModuleDestroy()', () => {
    it('clears the timer without throwing', () => {
      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('cache key', () => {
    it('exports the correct LAST_INDEXED_LEDGER_KEY constant', () => {
      expect(LAST_INDEXED_LEDGER_KEY).toBe('indexer:last_ledger');
    });
  });
});
