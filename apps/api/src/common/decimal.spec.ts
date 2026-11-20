import { divideDecimals, sumDecimals, toScaledBigInt } from './decimal';

describe('decimal helpers', () => {
  it('sums two swaps of "0.1" to exactly "0.2"', () => {
    expect(sumDecimals(['0.1', '0.1'])).toBe('0.2');
  });

  it('skips null amounts instead of coercing them to 0', () => {
    expect(sumDecimals(['0.1', null, undefined, '0.1'])).toBe('0.2');
    expect(toScaledBigInt(null)).toBeNull();
  });

  it('divides exactly and rejects a zero divisor', () => {
    expect(divideDecimals('1', '4')).toBe('0.25');
    expect(divideDecimals('1', '0')).toBeNull();
  });
});
