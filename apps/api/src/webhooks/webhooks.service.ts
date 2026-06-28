import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookWorker } from './webhook.processor';
import {
  WEBHOOK_EVENTS,
  WebhookEventType,
  WebhookPayload,
} from './webhook.types';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: WebhookWorker,
  ) {}

  /**
   * Register a new webhook for the given wallet.
   * Writes a 'created' audit log entry after the webhook is persisted.
   */
  async create(
    ownerWallet: string,
    url: string,
    eventTypes: WebhookEventType[],
    secret?: string,
    largeSwapUsd?: number,
  ) {
    const validTypes = eventTypes.filter((e) =>
      (WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    const webhook = await this.prisma.webhook.create({
      data: {
        ownerWallet,
        url,
        eventTypes: validTypes,
        secret,
        largeSwapUsd: largeSwapUsd ?? 10000,
      },
      select: { id: true, url: true, eventTypes: true, createdAt: true },
    });

    await this.prisma.webhookAuditLog.create({
      data: {
        webhookId: webhook.id,
        action: 'created',
        ownerWallet,
        meta: JSON.stringify({ url, eventTypes: validTypes }),
      },
    });

    return webhook;
  }

  /**
   * List all webhooks belonging to the given wallet.
   */
  list(ownerWallet: string) {
    return this.prisma.webhook.findMany({
      where: { ownerWallet },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        disabled: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delete a webhook, scoped to the owning wallet.
   * Writes a 'deleted' audit log entry when the webhook is found and removed.
   */
  async remove(id: string, ownerWallet: string) {
    const deleted = await this.prisma.webhook.deleteMany({
      where: { id, ownerWallet },
    });

    if (deleted.count > 0) {
      await this.prisma.webhookAuditLog.create({
        data: {
          webhookId: id,
          action: 'deleted',
          ownerWallet,
          meta: '{}',
        },
      });
    }
  }

  /**
   * Return the audit log for webhooks owned by the given wallet,
   * most recent entries first.
   */
  auditLog(ownerWallet: string) {
    return this.prisma.webhookAuditLog.findMany({
      where: { ownerWallet },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        webhookId: true,
        action: true,
        meta: true,
        createdAt: true,
      },
    });
  }

  /**
   * Fan-out an event to all enabled webhooks subscribed to it.
   */
  async dispatch(event: WebhookEventType, data: Record<string, unknown>) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { disabled: false, eventTypes: { has: event } },
      select: { id: true },
    });

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };
    await Promise.all(
      webhooks.map((w: { id: string }) => this.worker.dispatch(w.id, payload)),
    );
  }
}
