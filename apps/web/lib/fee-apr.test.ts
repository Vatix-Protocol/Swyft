import { describe, expect, it } from 'vitest';
import { formatFeeApr } from './fee-apr';

describe('formatFeeApr', () => {
  it('formats the already-percent APR value without scaling it again', () => {
    expect(formatFeeApr(36.5)).toBe('36.50%');
    expect(formatFeeApr('0.164')).toBe('0.16%');
  });

  it('formats zero APR', () => {
    expect(formatFeeApr(0)).toBe('0.00%');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 'not-a-number'])(
    'renders invalid APR %s as unavailable',
    (value) => {
      expect(formatFeeApr(value)).toBe('N/A');
    },
  );
});
