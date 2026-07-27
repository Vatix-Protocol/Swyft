import {
  WEBHOOK_RETRY_ATTEMPTS,
  WEBHOOK_RETRY_BACKOFF_MS,
  webhookBackoffDelayMs,
  webhookBackoffSchedule,
} from './webhook-backoff';

describe('webhookBackoffSchedule', () => {
  it('uses base delay of 2000ms by default', () => {
    expect(WEBHOOK_RETRY_BACKOFF_MS).toBe(2000);
  });

  it('caps retries at WEBHOOK_RETRY_ATTEMPTS (default 3)', () => {
    expect(WEBHOOK_RETRY_ATTEMPTS).toBe(3);
    expect(webhookBackoffSchedule()).toHaveLength(3);
  });

  it('schedules exponential delays: 0, base, 2*base', () => {
    expect(webhookBackoffSchedule(2000, 3)).toEqual([0, 2000, 4000]);
  });

  it('extends schedule when maxAttempts increases', () => {
    expect(webhookBackoffSchedule(2000, 5)).toEqual([
      0, 2000, 4000, 8000, 16000,
    ]);
  });

  it('returns null for attempts outside 1..maxAttempts (retries stop at max)', () => {
    expect(webhookBackoffDelayMs(0, 2000, 3)).toBeNull();
    expect(webhookBackoffDelayMs(4, 2000, 3)).toBeNull();
    expect(webhookBackoffDelayMs(3, 2000, 3)).toBe(4000);
  });
});
