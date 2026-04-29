export const WEBHOOK_EVENTS = ['pool.created', 'swap.large', 'pool.tvl.milestone'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}
