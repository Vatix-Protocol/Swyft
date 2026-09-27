import { randomUUID } from 'crypto';

/**
 * Correlation ids are echoed back to clients and written to logs, so a
 * client-supplied value is only accepted when it is short and made of a
 * conservative character set. Anything else (arrays, oversized values,
 * control characters that could forge log lines) is replaced with a fresh
 * server-generated id.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveCorrelationId(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  for (const name of ['x-correlation-id', 'x-request-id']) {
    const value = headers?.[name];
    if (typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)) {
      return value;
    }
  }
  return randomUUID();
}
