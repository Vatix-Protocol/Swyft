import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookEventType } from './webhook.types';

const mockService = {
  create: jest.fn().mockResolvedValue({ id: 'wh-1', url: 'https://example.com', eventTypes: ['pool.created'] }),
  list: jest.fn().mockResolvedValue([{ id: 'wh-1', url: 'https://example.com', eventTypes: ['pool.created'], disabled: false, createdAt: new Date() }]),
  remove: jest.fn().mockResolvedValue(undefined),
};

describe('WebhooksController', () => {
  let controller: WebhooksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: mockService }],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    jest.clearAllMocks();
  });

  it('creates a webhook for the authenticated wallet', async () => {
    const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };
    const body = { url: 'https://example.com', eventTypes: ['pool.created'] as WebhookEventType[] };

    const result = await controller.create(request as any, body);

    expect(mockService.create).toHaveBeenCalledWith(
      'GTEST_WALLET_ADDRESS',
      body.url,
      body.eventTypes,
      undefined,
      undefined,
    );
    expect(result).toEqual({ id: 'wh-1', url: 'https://example.com', eventTypes: ['pool.created'] });
  });

  it('lists webhooks and exposes loading:false in the response', async () => {
    const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };

    const response = await controller.list(request as any);

    expect(mockService.list).toHaveBeenCalledWith('GTEST_WALLET_ADDRESS');
    expect(response).toEqual({ loading: false, items: expect.any(Array) });
  });

  it('removes a webhook owned by the authenticated wallet', async () => {
    const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };

    await controller.remove('wh-1', request as any);

    expect(mockService.remove).toHaveBeenCalledWith('wh-1', 'GTEST_WALLET_ADDRESS');
  });
});
