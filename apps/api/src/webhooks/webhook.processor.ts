import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookPayload } from './webhook.types';

export const WEBHOOK_QUEUE = 'webhook-delivery';
const MAX_CONSECUTIVE_FAILS = 10;
const REDIS_CONNECTION = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

export interface WebhookJob {
  webhookId: string;
  payload: WebhookPayload;
}

@Injectable()
export class WebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorker.name);
  private worker!: Worker<WebhookJob>;
  readonly queue = new Queue<WebhookJob>(WEBHOOK_QUEUE, { connection: REDIS_CONNECTION });

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.worker = new Worker<WebhookJob>(
      WEBHOOK_QUEUE,
      (job) => this.deliver(job),
      {
        connection: REDIS_CONNECTION,
        limiter: { max: 50, duration: 1000 },
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`webhook delivery failed jobId=${job?.id} err=${err.message}`);
    });
    this.logger.log('Webhook worker started');
  }

  async onModuleDestroy() {
    await this.worker.close();
    await this.queue.close();
  }

  async dispatch(webhookId: string, payload: WebhookPayload) {
    await this.queue.add('deliver', { webhookId, payload }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  private async deliver(job: Job<WebhookJob>): Promise<void> {
    const { webhookId, payload } = job.data;
    const webhook = await this.prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!webhook || webhook.disabled) return;

    const body = JSON.stringify(payload);
    const signature = webhook.secret
      ? createHmac('sha256', webhook.secret).update(body).digest('hex')
      : undefined;

    const start = Date.now();
    let responseStatus: number | undefined;

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-Swyft-Signature': signature } : {}),
        },
        body,
      });
      responseStatus = res.status;
    } catch {
      // network failure — BullMQ will retry
    }

    const deliveryMs = Date.now() - start;
    const success = responseStatus !== undefined && responseStatus < 400;

    await this.prisma.webhookDelivery.create({
      data: { webhookId, eventType: payload.event, responseStatus, deliveryMs },
    });

    if (!success) {
      const fails = webhook.consecutiveFails + 1;
      const disabled = fails >= MAX_CONSECUTIVE_FAILS;
      await this.prisma.webhook.update({
        where: { id: webhookId },
        data: { consecutiveFails: fails, disabled },
      });
      if (disabled) {
        this.logger.warn(`Webhook ${webhookId} disabled after ${MAX_CONSECUTIVE_FAILS} consecutive failures`);
      }
      throw new Error(`Delivery failed with status ${responseStatus ?? 'network error'}`);
    }

    await this.prisma.webhook.update({ where: { id: webhookId }, data: { consecutiveFails: 0 } });
    this.logger.log(`Delivered ${payload.event} to ${webhookId} [${responseStatus}] in ${deliveryMs}ms`);
  }
}
