import { Test, TestingModule } from '@nestjs/testing';
import { WebhookWorker, WebhookJob, WEBHOOK_QUEUE } from './webhook.processor';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookPayload } from './webhook.types';
import { Job } from 'bullmq';

// ── Mock factories ────────────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    webhook: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    webhookDelivery: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function buildMockQueue() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseWebhook = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  secret: null as string | null,
  disabled: false,
  consecutiveFails: 0,
};

const basePayload: WebhookPayload = {
  event: 'pool.created',
  timestamp: '2025-01-15T10:30:00.000Z',
  data: { poolId: 'pool-1', token0: 'XLM', token1: 'USDC' },
};

function makeJob(data: WebhookJob): Job<WebhookJob> {
  return { data } as Job<WebhookJob>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let fetchSpy: jest.SpyInstance;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhookWorker (dispatch integration)', () => {
  let worker: WebhookWorker;
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookWorker,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    worker = module.get<WebhookWorker>(WebhookWorker);

    // Stub the BullMQ queue so no real Redis connection is opened
    (worker as any).queue = buildMockQueue();

    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ status: 200 } as Response);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  // ── dispatch (queue integration) ──────────────────────────────────────────

  describe('dispatch()', () => {
    it('enqueues a deliver job with the correct webhook id and payload', async () => {
      await worker.dispatch('wh-1', basePayload);

      expect((worker as any).queue.add).toHaveBeenCalledWith(
        'deliver',
        { webhookId: 'wh-1', payload: basePayload },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('uses exponential back-off for retries', async () => {
      await worker.dispatch('wh-1', basePayload);

      const [, , opts] = (worker as any).queue.add.mock.calls[0];
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 2000 });
    });

    it('resolves without throwing on successful enqueue', async () => {
      await expect(worker.dispatch('wh-1', basePayload)).resolves.toBeUndefined();
    });

    it('propagates errors when the queue rejects', async () => {
      (worker as any).queue.add.mockRejectedValue(new Error('queue full'));

      await expect(worker.dispatch('wh-1', basePayload)).rejects.toThrow(
        'queue full',
      );
    });
  });

  // ── deliver (processor integration) ───────────────────────────────────────

  describe('deliver()', () => {
    const deliver = (data: WebhookJob) =>
      (worker as any).deliver(makeJob(data));

    it('skips delivery when the webhook record is not found', async () => {
      prisma.webhook.findUnique.mockResolvedValue(null);

      await deliver({ webhookId: 'wh-missing', payload: basePayload });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips delivery when the webhook is disabled', async () => {
      prisma.webhook.findUnique.mockResolvedValue({
        ...baseWebhook,
        disabled: true,
      });

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('POSTs the JSON payload to the webhook URL', async () => {
      prisma.webhook.findUnique.mockResolvedValue(baseWebhook);

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      expect(fetchSpy).toHaveBeenCalledWith(
        baseWebhook.url,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(basePayload),
        }),
      );
    });

    it('includes Content-Type: application/json header', async () => {
      prisma.webhook.findUnique.mockResolvedValue(baseWebhook);

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('attaches X-Swyft-Signature when webhook has a secret', async () => {
      prisma.webhook.findUnique.mockResolvedValue({
        ...baseWebhook,
        secret: 'hmac-secret',
      });

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['X-Swyft-Signature']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('omits X-Swyft-Signature when webhook has no secret', async () => {
      prisma.webhook.findUnique.mockResolvedValue(baseWebhook);

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['X-Swyft-Signature']).toBeUndefined();
    });

    it('records a delivery log entry after each attempt', async () => {
      prisma.webhook.findUnique.mockResolvedValue(baseWebhook);

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: 'wh-1',
          eventType: basePayload.event,
          responseStatus: 200,
        }),
      });
    });

    it('resets consecutiveFails to 0 on success', async () => {
      prisma.webhook.findUnique.mockResolvedValue({
        ...baseWebhook,
        consecutiveFails: 3,
      });

      await deliver({ webhookId: 'wh-1', payload: basePayload });

      expect(prisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { consecutiveFails: 0 },
      });
    });

    it('increments consecutiveFails on HTTP 4xx response', async () => {
      fetchSpy.mockResolvedValue({ status: 500 } as Response);
      prisma.webhook.findUnique.mockResolvedValue({
        ...baseWebhook,
        consecutiveFails: 2,
      });

      await expect(
        deliver({ webhookId: 'wh-1', payload: basePayload }),
      ).rejects.toThrow(/Delivery failed/);

      expect(prisma.webhook.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ consecutiveFails: 3 }),
        }),
      );
    });

    it('disables the webhook after 10 consecutive failures', async () => {
      fetchSpy.mockResolvedValue({ status: 503 } as Response);
      prisma.webhook.findUnique.mockResolvedValue({
        ...baseWebhook,
        consecutiveFails: 9,
      });

      await expect(
        deliver({ webhookId: 'wh-1', payload: basePayload }),
      ).rejects.toThrow();

      expect(prisma.webhook.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ disabled: true }),
        }),
      );
    });

    it('handles network errors gracefully and records undefined status', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      prisma.webhook.findUnique.mockResolvedValue(baseWebhook);

      await expect(
        deliver({ webhookId: 'wh-1', payload: basePayload }),
      ).rejects.toThrow(/Delivery failed/);

      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          responseStatus: undefined,
        }),
      });
    });
  });
});
