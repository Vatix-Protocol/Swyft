/** Base delay (ms) for BullMQ exponential backoff between delivery attempts. */
export const WEBHOOK_RETRY_ATTEMPTS = Number(
  process.env.WEBHOOK_RETRY_ATTEMPTS ?? '3',
);
export const WEBHOOK_RETRY_BACKOFF_MS = Number(
  process.env.WEBHOOK_RETRY_BACKOFF_MS ?? '2000',
);

/**
 * BullMQ exponential backoff delay for a given 1-based attempt number.
 * Attempt 1 runs immediately (0 ms); subsequent attempts wait
 * `baseDelayMs * 2^(attempt - 2)`.
 *
 * Retries stop once `attempt > maxAttempts` (job is not scheduled again).
 */
export function webhookBackoffDelayMs(
  attempt: number,
  baseDelayMs: number = WEBHOOK_RETRY_BACKOFF_MS,
  maxAttempts: number = WEBHOOK_RETRY_ATTEMPTS,
): number | null {
  if (attempt < 1 || attempt > maxAttempts) return null;
  if (attempt === 1) return 0;
  return baseDelayMs * 2 ** (attempt - 2);
}

/** Full backoff schedule (ms) for attempts 1..maxAttempts. */
export function webhookBackoffSchedule(
  baseDelayMs: number = WEBHOOK_RETRY_BACKOFF_MS,
  maxAttempts: number = WEBHOOK_RETRY_ATTEMPTS,
): number[] {
  return Array.from({ length: maxAttempts }, (_, i) =>
    webhookBackoffDelayMs(i + 1, baseDelayMs, maxAttempts)!,
  );
}
