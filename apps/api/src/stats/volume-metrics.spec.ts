import {
  calculateSwapFeesUsd,
  calculateSwapVolumeUsd,
  isInHalfOpenWindow,
} from './volume-metrics';

describe('swap USD metrics', () => {
  it('converts both swap sides from base units before applying USD prices', () => {
    expect(
      calculateSwapVolumeUsd(
        { amount0: '-1500000', amount1: '2500000' },
        6,
        6,
        2,
        3,
      ),
    ).toBe(10.5);
  });

  it('values token0 fees using token0 decimals and price', () => {
    expect(calculateSwapFeesUsd('30000', 6, 2)).toBeCloseTo(0.06);
  });

  it('rejects malformed amounts, decimals, or missing prices', () => {
    expect(() =>
      calculateSwapVolumeUsd({ amount0: '1.5', amount1: '1' }, 6, 6, 1, 1),
    ).toThrow('Swap amount is invalid');
    expect(() => calculateSwapFeesUsd('100', 19, 1)).toThrow(
      'Token decimals are invalid',
    );
    expect(() => calculateSwapFeesUsd('100', 6, Number.NaN)).toThrow(
      'Token USD price is invalid',
    );
  });

  it('uses a half-open time window including its start and excluding its end', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-01-02T00:00:00.000Z');
    expect(isInHalfOpenWindow(start, start, end)).toBe(true);
    expect(isInHalfOpenWindow(new Date(end.getTime() - 1), start, end)).toBe(
      true,
    );
    expect(isInHalfOpenWindow(end, start, end)).toBe(false);
    expect(isInHalfOpenWindow(new Date(start.getTime() - 1), start, end)).toBe(
      false,
    );
  });
});
