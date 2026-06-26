export const WEBHOOK_EVENTS = [
  'pool.created',
  'swap',
  'swap.large',
  'pool.tvl.milestone',
  'position.minted',
  'position.burned',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}
