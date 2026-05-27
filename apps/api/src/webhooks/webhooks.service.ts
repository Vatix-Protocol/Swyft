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

  /**
   * Register a new webhook for the given wallet.
   *
   * @param ownerWallet - Stellar account address of the webhook owner.
   * @param url - HTTPS endpoint that will receive POST deliveries.
   * @param eventTypes - One or more event types to subscribe to.
   * @param secret - Optional HMAC-SHA256 signing secret; when set, deliveries include an `X-Swyft-Signature` header.
   * @param largeSwapUsd - USD threshold for `swap.large` events (default: 10 000).
   * @returns The created webhook record (id, url, eventTypes, createdAt).
   */
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

  /**
   * List all webhooks belonging to the given wallet.
   *
   * @param ownerWallet - Stellar account address of the webhook owner.
   * @returns Array of webhook records (id, url, eventTypes, disabled, createdAt).
   */
  list(ownerWallet: string) {
    return this.prisma.webhook.findMany({
      where: { ownerWallet },
      select: { id: true, url: true, eventTypes: true, disabled: true, createdAt: true },
    });
  }

  /**
   * Delete a webhook, scoped to the owning wallet.
   *
   * @param id - UUID of the webhook to delete.
   * @param ownerWallet - Stellar account address; only the owner may delete.
   * @returns Resolves when the record has been removed (no-op if not found).
   */
  async remove(id: string, ownerWallet: string) {
    await this.prisma.webhook.deleteMany({ where: { id, ownerWallet } });
  }

  /**
   * Fan-out an event to all enabled webhooks subscribed to it.
   *
   * @param event - The event type being emitted.
   * @param data - Arbitrary event payload; must be JSON-serialisable.
   * @returns Resolves once all delivery jobs have been enqueued.
   */
  async dispatch(event: WebhookEventType, data: Record<string, unknown>) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { disabled: false, eventTypes: { has: event } },
      select: { id: true },
    });

    const payload: WebhookPayload = { event, timestamp: new Date().toISOString(), data };
    await Promise.all(webhooks.map((w) => this.worker.dispatch(w.id, payload)));
  }
}
