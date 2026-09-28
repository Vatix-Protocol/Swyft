import {
  getAmountsForLiquidity,
  tickToSqrtPriceX96,
} from '@swyft/sdk/position-math';
import { calculatePoolTvl } from './pool-tvl';

describe('calculatePoolTvl', () => {
  const position = {
    lowerTick: -200,
    upperTick: 200,
    liquidity: '1000000000000',
  };
  const currentSqrtPrice = (1n << 96n).toString();

  it('values each open position at its own range using integer amount math', () => {
    const result = calculatePoolTvl({
      currentSqrtPrice,
      positions: [position],
      price0: 2,
      price1: 3,
      decimals0: 6,
      decimals1: 7,
    });
    const { amount0, amount1 } = getAmountsForLiquidity({
      sqrtPriceX96: BigInt(currentSqrtPrice),
      sqrtPriceLowerX96: tickToSqrtPriceX96(position.lowerTick),
      sqrtPriceUpperX96: tickToSqrtPriceX96(position.upperTick),
      liquidity: BigInt(position.liquidity),
    });
    const expected =
      (Number(amount0) / 10 ** 6) * 2 + (Number(amount1) / 10 ** 7) * 3;
    expect(result).toBe(expected);
  });

  it('sums distinct ranges rather than applying aggregate pool liquidity once', () => {
    const result = calculatePoolTvl({
      currentSqrtPrice,
      positions: [
        position,
        { lowerTick: -100, upperTick: 100, liquidity: '1000000000000' },
      ],
      price0: 1,
      price1: 1,
      decimals0: 0,
      decimals1: 0,
    });
    const onePosition = calculatePoolTvl({
      currentSqrtPrice,
      positions: [position],
      price0: 1,
      price1: 1,
      decimals0: 0,
      decimals1: 0,
    });
    expect(result).toBeGreaterThan(onePosition);
  });

  it('returns zero only when there are no open positions', () => {
    expect(
      calculatePoolTvl({
        currentSqrtPrice,
        positions: [],
        price0: 1,
        price1: 1,
        decimals0: 7,
        decimals1: 18,
      }),
    ).toBe(0);
  });

  it.each([
    { price0: 0, price1: 1 },
    { price0: 1, price1: Number.NaN },
  ])('rejects missing or invalid USD prices', ({ price0, price1 }) => {
    expect(() =>
      calculatePoolTvl({
        currentSqrtPrice,
        positions: [position],
        price0,
        price1,
        decimals0: 7,
        decimals1: 7,
      }),
    ).toThrow('Pool USD prices are invalid');
  });

  it('rejects malformed position data rather than storing misleading TVL', () => {
    expect(() =>
      calculatePoolTvl({
        currentSqrtPrice,
        positions: [{ ...position, liquidity: '-1' }],
        price0: 1,
        price1: 1,
        decimals0: 7,
        decimals1: 7,
      }),
    ).toThrow('Indexed position liquidity is invalid');
  });
});
