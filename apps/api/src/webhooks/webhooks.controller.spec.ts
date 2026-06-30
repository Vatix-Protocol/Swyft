import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import {
  WebhookEventType,
  WEBHOOK_EVENTS,
  WEBHOOK_PAYLOAD_EXAMPLES,
  verifyWebhookSignature,
} from './webhook.types';

const mockService = {
  create: jest.fn().mockResolvedValue({
    id: 'wh-1',
    url: 'https://example.com',
    eventTypes: ['pool.created'],
  }),
  list: jest.fn().mockResolvedValue([
    {
      id: 'wh-1',
      url: 'https://example.com',
      eventTypes: ['pool.created'],
      disabled: false,
      createdAt: new Date(),
    },
  ]),
  remove: jest.fn().mockResolvedValue(undefined),
  auditLog: jest.fn().mockResolvedValue([
    {
      id: 'log-1',
      webhookId: 'wh-1',
      action: 'created',
      meta: '{}',
      createdAt: new Date(),
    },
  ]),
  retryDeliveries: jest.fn().mockResolvedValue({ retried: 0 }),
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
    mockService.create.mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com',
      eventTypes: ['pool.created'],
    });
    const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };
    const body = {
      url: 'https://example.com',
      eventTypes: ['pool.created'] as WebhookEventType[],
    };

    const result = await controller.create(request, body);

    expect(mockService.create).toHaveBeenCalledWith(
      'GTEST_WALLET_ADDRESS',
      body.url,
      body.eventTypes,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      id: 'wh-1',
      url: 'https://example.com',
      eventTypes: ['pool.created'],
    });
  });

  it('lists webhooks and exposes loading:false in the response', async () => {
    mockService.list.mockResolvedValue([]);
    const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };

    const response = await controller.list(request);

    expect(mockService.list).toHaveBeenCalledWith('GTEST_WALLET_ADDRESS');
    expect(response).toEqual({ loading: false, items: expect.any(Array) });
  });

  it('removes a webhook owned by the authenticated wallet', async () => {
    const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };

    await controller.remove('wh-1', request);

    expect(mockService.remove).toHaveBeenCalledWith(
      'wh-1',
      'GTEST_WALLET_ADDRESS',
    );
  });

  // ── retryDeliveries ───────────────────────────────────────────────────────

  describe('retryDeliveries', () => {
    it('delegates to service.retryDeliveries with the webhook id and wallet', async () => {
      mockService.retryDeliveries.mockResolvedValue({ retried: 3 });
      const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };

      const result = await controller.retryDeliveries('wh-1', request);

      expect(mockService.retryDeliveries).toHaveBeenCalledWith(
        'wh-1',
        'GTEST_WALLET_ADDRESS',
      );
      expect(result).toEqual({ retried: 3 });
    });

    it('returns { retried: 0 } when no failed jobs exist', async () => {
      mockService.retryDeliveries.mockResolvedValue({ retried: 0 });
      const request = { user: { walletAddress: 'GTEST_WALLET_ADDRESS' } };

      const result = await controller.retryDeliveries('wh-1', request);

      expect(result).toEqual({ retried: 0 });
    });
  });

  // ── verifySignature ────────────────────────────────────────────────────────

  describe('verifySignature', () => {
    it('returns { valid: true } for a correct HMAC signature', () => {
      const { createHmac } = require('crypto');
      const secret = 'test-secret';
      const payload = '{"event":"swap"}';
      const signature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const result = controller.verifySignature({ payload, signature, secret });

      expect(result).toEqual({ valid: true });
    });

    it('returns { valid: false } for an incorrect signature', () => {
      const result = controller.verifySignature({
        payload: '{"event":"swap"}',
        signature: 'badsignature00',
        secret: 'test-secret',
      });

      expect(result).toEqual({ valid: false });
    });

    it('uses verifyWebhookSignature from webhook.types', () => {
      const secret = 'test-secret';
      const payload = '{"event":"pool.created"}';
      const { createHmac } = require('crypto');
      const sig = createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
      expect(verifyWebhookSignature(payload, 'wrong', secret)).toBe(false);
    });
  });

  // ── #409: payload examples ─────────────────────────────────────────────────

  describe('eventExamples', () => {
    it('returns examples for every webhook event type', () => {
      const examples = controller.eventExamples();
      for (const event of WEBHOOK_EVENTS) {
        expect(examples).toHaveProperty(event);
      }
    });

    it('returns the canonical WEBHOOK_PAYLOAD_EXAMPLES object', () => {
      expect(controller.eventExamples()).toBe(WEBHOOK_PAYLOAD_EXAMPLES);
    });

    it('each example has event, timestamp, and data fields', () => {
      const examples = controller.eventExamples();
      for (const event of WEBHOOK_EVENTS) {
        const ex = examples[event];
        expect(ex.event).toBe(event);
        expect(typeof ex.timestamp).toBe('string');
        expect(ex.data).toBeDefined();
      }
    });
  });
});
