import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookWorker } from './webhook.processor';
import { WEBHOOK_EVENTS, WebhookEventType, WebhookPayload } from './webhook.types';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: WebhookWorker,
  ) {}

  create(
    ownerWallet: string,
    url: string,
    eventTypes: WebhookEventType[],
    secret?: string,
    largeSwapUsd?: number,
  ) {
    const validTypes = eventTypes.filter((e) =>
      (WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    return this.prisma.webhook.create({
      data: { ownerWallet, url, eventTypes: validTypes, secret, largeSwapUsd: largeSwapUsd ?? 10000 },
      select: { id: true, url: true, eventTypes: true, createdAt: true },
    });
  }

  list(ownerWallet: string) {
    return this.prisma.webhook.findMany({
      where: { ownerWallet },
      select: { id: true, url: true, eventTypes: true, disabled: true, createdAt: true },
    });
  }

  async remove(id: string, ownerWallet: string) {
    await this.prisma.webhook.deleteMany({ where: { id, ownerWallet } });
  }

  async dispatch(event: WebhookEventType, data: Record<string, unknown>) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { disabled: false, eventTypes: { has: event } },
      select: { id: true },
    });

    const payload: WebhookPayload = { event, timestamp: new Date().toISOString(), data };
    await Promise.all(webhooks.map((w) => this.worker.dispatch(w.id, payload)));
  }
}
