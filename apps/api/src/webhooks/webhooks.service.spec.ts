import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { WebhookWorker } from './webhook.processor';
import { PrismaService } from '../prisma/prisma.service';
import {
  WEBHOOK_EVENTS,
  WebhookEventType,
  WebhookPayload,
} from './webhook.types';

// ── Mock factories ────────────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    webhook: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    webhookAuditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function buildMockWorker() {
  return {
    dispatch: jest.fn().mockResolvedValue(undefined),
    retryFailedDeliveries: jest.fn().mockResolvedValue(0),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER = 'GTEST_WALLET_ADDRESS';
const URL = 'https://example.com/webhook';
const EVENT_TYPES: WebhookEventType[] = ['pool.created', 'swap.large'];
const SECRET = 'test-hmac-secret';

const mockWebhookRecord = {
  id: 'wh-uuid-1',
  url: URL,
  eventTypes: EVENT_TYPES,
  createdAt: new Date(),
};

const mockWebhookListRecord = {
  id: 'wh-uuid-1',
  url: URL,
  eventTypes: EVENT_TYPES,
  disabled: false,
  createdAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let worker: ReturnType<typeof buildMockWorker>;

  beforeEach(async () => {
    prisma = buildMockPrisma();
    worker = buildMockWorker();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebhookWorker, useValue: worker },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to prisma.webhook.create with correct fields', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      await service.create(OWNER, URL, EVENT_TYPES, SECRET);

      expect(prisma.webhook.create).toHaveBeenCalledWith({
        data: {
          ownerWallet: OWNER,
          url: URL,
          eventTypes: EVENT_TYPES,
          secret: SECRET,
          largeSwapUsd: 10000,
        },
        select: { id: true, url: true, eventTypes: true, createdAt: true },
      });
    });

    it('uses the provided largeSwapUsd threshold', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      await service.create(OWNER, URL, EVENT_TYPES, undefined, 5000);

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ largeSwapUsd: 5000 }),
        }),
      );
    });

    it('defaults largeSwapUsd to 10000 when not provided', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      await service.create(OWNER, URL, EVENT_TYPES);

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ largeSwapUsd: 10000 }),
        }),
      );
    });

    it('filters out unknown event types before persisting', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);
      const invalidTypes = [
        'pool.created',
        'unknown.event',
      ] as WebhookEventType[];

      await service.create(OWNER, URL, invalidTypes);

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventTypes: ['pool.created'] }),
        }),
      );
    });

    it('passes through all valid WEBHOOK_EVENTS without filtering', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);
      const all = [...WEBHOOK_EVENTS] as WebhookEventType[];

      await service.create(OWNER, URL, all);

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventTypes: all }),
        }),
      );
    });

    it('returns the record from prisma', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      const result = await service.create(OWNER, URL, EVENT_TYPES);

      expect(result).toEqual(mockWebhookRecord);
    });

    it('writes a created audit log entry after persisting the webhook', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      await service.create(OWNER, URL, EVENT_TYPES);

      expect(prisma.webhookAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: mockWebhookRecord.id,
          action: 'created',
          ownerWallet: OWNER,
        }),
      });
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('queries only webhooks belonging to the given wallet', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhookListRecord]);

      await service.list(OWNER);

      expect(prisma.webhook.findMany).toHaveBeenCalledWith({
        where: { ownerWallet: OWNER },
        select: {
          id: true,
          url: true,
          eventTypes: true,
          disabled: true,
          createdAt: true,
        },
      });
    });

    it('returns the array from prisma', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhookListRecord]);

      const result = await service.list(OWNER);

      expect(result).toEqual([mockWebhookListRecord]);
    });

    it('returns an empty array when the wallet has no webhooks', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);

      const result = await service.list(OWNER);

      expect(result).toEqual([]);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('calls deleteMany scoped to the webhook id and owner wallet', async () => {
      prisma.webhook.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('wh-uuid-1', OWNER);

      expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({
        where: { id: 'wh-uuid-1', ownerWallet: OWNER },
      });
    });

    it('resolves without throwing when the webhook does not exist', async () => {
      prisma.webhook.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.remove('nonexistent-id', OWNER),
      ).resolves.toBeUndefined();
    });

    it('does not allow deleting a webhook owned by a different wallet', async () => {
      prisma.webhook.deleteMany.mockResolvedValue({ count: 0 });

      await service.remove('wh-uuid-1', 'GDIFFERENT_WALLET');

      expect(prisma.webhook.deleteMany).toHaveBeenCalledWith({
        where: { id: 'wh-uuid-1', ownerWallet: 'GDIFFERENT_WALLET' },
      });
    });

    it('writes a deleted audit log entry when the webhook was found and removed', async () => {
      prisma.webhook.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('wh-uuid-1', OWNER);

      expect(prisma.webhookAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: 'wh-uuid-1',
          action: 'deleted',
          ownerWallet: OWNER,
        }),
      });
    });

    it('does not write an audit log entry when the webhook was not found', async () => {
      prisma.webhook.deleteMany.mockResolvedValue({ count: 0 });

      await service.remove('nonexistent-id', OWNER);

      expect(prisma.webhookAuditLog.create).not.toHaveBeenCalled();
    });
  });

  // ── auditLog ──────────────────────────────────────────────────────────────

  describe('auditLog', () => {
    const mockAuditEntries = [
      {
        id: 'log-1',
        webhookId: 'wh-uuid-1',
        action: 'created',
        meta: '{"url":"https://example.com"}',
        createdAt: new Date(),
      },
    ];

    it('queries audit log entries for the given wallet in descending order', async () => {
      prisma.webhookAuditLog.findMany.mockResolvedValue(mockAuditEntries);

      await service.auditLog(OWNER);

      expect(prisma.webhookAuditLog.findMany).toHaveBeenCalledWith({
        where: { ownerWallet: OWNER },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          webhookId: true,
          action: true,
          meta: true,
          createdAt: true,
        },
      });
    });

    it('returns the entries from prisma', async () => {
      prisma.webhookAuditLog.findMany.mockResolvedValue(mockAuditEntries);

      const result = await service.auditLog(OWNER);

      expect(result).toEqual(mockAuditEntries);
    });

    it('returns an empty array when no audit entries exist', async () => {
      prisma.webhookAuditLog.findMany.mockResolvedValue([]);

      const result = await service.auditLog(OWNER);

      expect(result).toEqual([]);
    });
  });

  // ── dispatch ──────────────────────────────────────────────────────────────

  describe('dispatch', () => {
    const event: WebhookEventType = 'pool.created';
    const data: Record<string, unknown> = {
      poolId: 'pool-1',
      token0: 'XLM',
      token1: 'USDC',
    };

    it('finds all enabled webhooks subscribed to the event', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);

      await service.dispatch(event, data);

      expect(prisma.webhook.findMany).toHaveBeenCalledWith({
        where: { disabled: false, eventTypes: { has: event } },
        select: { id: true },
      });
    });

    it('enqueues one delivery job per matching webhook', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1' },
        { id: 'wh-2' },
      ]);

      await service.dispatch(event, data);

      expect(worker.dispatch).toHaveBeenCalledTimes(2);
    });

    it('passes the correct payload to the worker', async () => {
      prisma.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }]);

      await service.dispatch(event, data);

      const [webhookId, payload] = worker.dispatch.mock.calls[0] as [
        string,
        WebhookPayload,
      ];
      expect(webhookId).toBe('wh-1');
      expect(payload.event).toBe(event);
      expect(payload.data).toEqual(data);
      expect(typeof payload.timestamp).toBe('string');
    });

    it('does not call the worker when no webhooks are subscribed', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);

      await service.dispatch(event, data);

      expect(worker.dispatch).not.toHaveBeenCalled();
    });

    it('resolves once all delivery jobs are enqueued', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1' },
        { id: 'wh-2' },
      ]);
      worker.dispatch.mockResolvedValue(undefined);

      await expect(service.dispatch(event, data)).resolves.toBeUndefined();
    });
  });

  // ── retryDeliveries ────────────────────────────────────────────────────────

  describe('retryDeliveries', () => {
    it('returns { retried: 0 } when the webhook does not belong to the wallet', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      const result = await service.retryDeliveries('wh-uuid-1', 'GDIFFERENT');

      expect(result).toEqual({ retried: 0 });
      expect(worker.retryFailedDeliveries).not.toHaveBeenCalled();
    });

    it('delegates to worker.retryFailedDeliveries when webhook is owned by the wallet', async () => {
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-uuid-1' });
      worker.retryFailedDeliveries.mockResolvedValue(2);

      const result = await service.retryDeliveries('wh-uuid-1', OWNER);

      expect(worker.retryFailedDeliveries).toHaveBeenCalledWith('wh-uuid-1');
      expect(result).toEqual({ retried: 2 });
    });

    it('returns { retried: 0 } when there are no failed jobs', async () => {
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-uuid-1' });
      worker.retryFailedDeliveries.mockResolvedValue(0);

      const result = await service.retryDeliveries('wh-uuid-1', OWNER);

      expect(result).toEqual({ retried: 0 });
    });
  });

  // ── largeSwapUsd env default ───────────────────────────────────────────────

  describe('create — largeSwapUsd env default', () => {
    afterEach(() => {
      delete process.env.LARGE_SWAP_THRESHOLD_USD;
    });

    it('uses LARGE_SWAP_THRESHOLD_USD env var when largeSwapUsd is not provided', async () => {
      process.env.LARGE_SWAP_THRESHOLD_USD = '25000';
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      await service.create(OWNER, URL, EVENT_TYPES);

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ largeSwapUsd: 25000 }),
        }),
      );
    });

    it('explicit largeSwapUsd overrides env var', async () => {
      process.env.LARGE_SWAP_THRESHOLD_USD = '25000';
      prisma.webhook.create.mockResolvedValue(mockWebhookRecord);

      await service.create(OWNER, URL, EVENT_TYPES, undefined, 5000);

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ largeSwapUsd: 5000 }),
        }),
      );
    });
  });
});
