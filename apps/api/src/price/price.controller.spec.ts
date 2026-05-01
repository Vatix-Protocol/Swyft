import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PriceController } from './price.controller';
import { PriceService, SpotPriceResponse } from './price.service';

const mockResponse: SpotPriceResponse = {
  tokenA: 'usdc',
  tokenB: 'xlm',
  spotPrice: '0.1',
  change24hAbsolute: '0.005',
  change24hPercent: '5.2632',
  high24h: '0.1',
  low24h: '0.1',
  lastUpdated: new Date().toISOString(),
};

describe('PriceController', () => {
  let controller: PriceController;
  let priceService: { getTokenPairPrice: jest.Mock };

  beforeEach(async () => {
    priceService = { getTokenPairPrice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PriceController],
      providers: [{ provide: PriceService, useValue: priceService }],
    }).compile();

    controller = module.get<PriceController>(PriceController);
  });

  it('returns spot price response for valid pair', async () => {
    priceService.getTokenPairPrice.mockResolvedValue(mockResponse);
    const result = await controller.getPrice('USDC', 'XLM');
    expect(result).toEqual(mockResponse);
    expect(priceService.getTokenPairPrice).toHaveBeenCalledWith('USDC', 'XLM');
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
