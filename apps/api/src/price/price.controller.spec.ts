import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PriceController } from './price.controller';
import { PriceService, SpotPriceResponse, PriceCandle } from './price.service';
import { CacheService } from '../cache/cache.service';

const mockSpotResponse: SpotPriceResponse = {
  tokenA: 'usdc',
  tokenB: 'xlm',
  spotPrice: '0.1',
  change24hAbsolute: '0.005',
  change24hPercent: '5.2632',
  high24h: '0.1',
  low24h: '0.1',
  lastUpdated: new Date().toISOString(),
};

const mockCandle: PriceCandle = {
  timestamp: 1700000000,
  open: '0.09',
  high: '0.11',
  low: '0.08',
  close: '0.10',
  volume: '50000',
};

describe('PriceController', () => {
  let controller: PriceController;
  let priceService: { getTokenPairPrice: jest.Mock; getCandles: jest.Mock };
  let cacheService: { get: jest.Mock; set: jest.Mock; invalidate: jest.Mock };

  beforeEach(async () => {
    priceService = {
      getTokenPairPrice: jest.fn(),
      getCandles: jest.fn(),
    };
    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PriceController],
      providers: [
        { provide: PriceService, useValue: priceService },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    controller = module.get<PriceController>(PriceController);
  });

  describe('getPrice()', () => {
    it('returns spot price response for valid pair', async () => {
      priceService.getTokenPairPrice.mockResolvedValue(mockSpotResponse);
      const result = await controller.getPrice('USDC', 'XLM');
      expect(result).toEqual(mockSpotResponse);
      expect(priceService.getTokenPairPrice).toHaveBeenCalledWith(
        'USDC',
        'XLM',
      );
    });

    it('propagates NotFoundException when no pool exists', async () => {
      priceService.getTokenPairPrice.mockRejectedValue(
        new NotFoundException('No pool found for token pair USDC/XLM'),
      );
      await expect(controller.getPrice('USDC', 'XLM')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCandles()', () => {
    it('returns { candles: [...] } shape from real candle data', async () => {
      priceService.getCandles.mockResolvedValue({
        poolId: 'pool-1',
        candles: [mockCandle],
      });
      const result = await controller.getCandles('USDC', 'XLM', '1h');
      expect(result).toEqual({ poolId: 'pool-1', candles: [mockCandle] });
    });

    it('serves from cache when a cached response exists', async () => {
      const cached = { candles: [mockCandle] };
      cacheService.get.mockResolvedValue(cached);
      const result = await controller.getCandles('USDC', 'XLM', '1h');
      expect(result).toEqual(cached);
      expect(priceService.getCandles).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no candles exist for the pair', async () => {
      priceService.getCandles.mockResolvedValue({
        poolId: 'pool-1',
        candles: [],
      });
      await expect(controller.getCandles('USDC', 'XLM', '1h')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for an unsupported interval', async () => {
      await expect(
        controller.getCandles('USDC', 'XLM', '2h' as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when limit is out of range', async () => {
      await expect(
        controller.getCandles('USDC', 'XLM', '1h', undefined, undefined, '0'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when from >= to', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expect(
        controller.getCandles(
          'USDC',
          'XLM',
          '1h',
          String(now),
          String(now - 1),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('caches the response after a successful fetch', async () => {
      priceService.getCandles.mockResolvedValue({
        poolId: 'pool-1',
        candles: [mockCandle],
      });
      await controller.getCandles('USDC', 'XLM', '1h');
      expect(cacheService.set).toHaveBeenCalledWith(
        expect.any(String),
        { poolId: 'pool-1', candles: [mockCandle] },
        expect.any(Number),
      );
    });
  });
});
