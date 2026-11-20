import { describe, it, expect } from 'vitest';
import { formatFeeTier } from './fee-tier';

describe('formatFeeTier', () => {
  it('formats "3000" as 0.30%', () => {
    expect(formatFeeTier('3000')).toBe('0.30%');
  });

  it('formats common tiers exactly', () => {
    expect(formatFeeTier('500')).toBe('0.05%');
    expect(formatFeeTier(10000)).toBe('1.00%');
  });
});
