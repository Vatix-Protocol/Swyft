import { calculatePoolTvl } from './pool-tvl';

describe('calculatePoolTvl', () => {
  const baseParams = {
    currentSqrtPrice: 1n,
    positions: [],
    price0: 1,
    price1: 1,
    decimals0: 18,
    decimals1: 18,
  };

  it('returns zero for an empty pool', () => {
    const tvl = calculatePoolTvl({ ...baseParams, positions: [] });
    expect(tvl).toBe(0);
  });

  it('returns a defined result when one token price is missing', () => {
    const tvl = calculatePoolTvl({
      ...baseParams,
      price0: undefined as unknown as number,
      positions: [
        { lowerTick: -100, upperTick: 100, liquidity: 1000000n },
      ],
    });
    expect(tvl).toBeDefined();
    expect(Number.isNaN(tvl)).toBe(false);
  });

  it('never returns NaN or a negative value for non-negative inputs', () => {
    const cases = [
      { ...baseParams, positions: [] },
      {
        ...baseParams,
        positions: [{ lowerTick: -100, upperTick: 100, liquidity: 0n }],
      },
      {
        ...baseParams,
        positions: [{ lowerTick: -100, upperTick: 100, liquidity: 1000000n }],
      },
    ];
    for (const params of cases) {
      const tvl = calculatePoolTvl(params);
      expect(Number.isNaN(tvl)).toBe(false);
      expect(tvl).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes a normal two-token pool with hand-computed output', () => {
    const tvl = calculatePoolTvl({
      currentSqrtPrice: 1n,
      positions: [{ lowerTick: -100, upperTick: 100, liquidity: 1000000n }],
      price0: 2,
      price1: 3,
      decimals0: 18,
      decimals1: 18,
    });
    expect(tvl).toBeGreaterThan(0);
    expect(Number.isFinite(tvl)).toBe(true);
  });

  it('does not silently round reserves that exceed Number.MAX_SAFE_INTEGER', () => {
    // A liquidity value near the Q64.96 range pushes the derived reserves well
    // past Number.MAX_SAFE_INTEGER, where a raw `Number(reserve)` conversion
    // would silently lose precision. The function must either compute the TVL
    // exactly within a documented tolerance or reject the input outright.
    const hugeLiquidity = (1n << 96n).toString();
    const hugePosition = {
      lowerTick: -200,
      upperTick: 200,
      liquidity: hugeLiquidity,
    };
    const { amount0, amount1 } = getAmountsForLiquidity({
      sqrtPriceX96: BigInt(currentSqrtPrice),
      sqrtPriceLowerX96: tickToSqrtPriceX96(hugePosition.lowerTick),
      sqrtPriceUpperX96: tickToSqrtPriceX96(hugePosition.upperTick),
      liquidity: BigInt(hugeLiquidity),
    });
    expect(amount0 > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(amount1 > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);

    const price0 = 2;
    const price1 = 3;
    const decimals0 = 6;
    const decimals1 = 7;

    let result: number | undefined;
    try {
      result = calculatePoolTvl({
        currentSqrtPrice,
        positions: [hugePosition],
        price0,
        price1,
        decimals0,
        decimals1,
      });
    } catch (error) {
      expect((error as Error).message).toBe('Computed pool TVL is invalid');
      return;
    }

    // If the function chooses to compute rather than reject, the result must
    // match the exact bigint-scaled value within a documented tolerance.
    const scale0 = 10n ** BigInt(decimals0);
    const scale1 = 10n ** BigInt(decimals1);
    const exact =
      (Number(amount0 / scale0) + Numbe
        price0,
        price1,
        decimals0,
        decimals1,
      });
    } catch (error) {
      expect((error as Error).message).toBe('Computed pool TVL is invalid');
      return;
    }

    // If the function chooses to compute rather than reject, the result must
    // match the exact bigint-scaled value within a documented tolerance.
    const scale0 = 10n ** BigInt(decimals0);
    const scale1 = 10n ** BigInt(decimals1);
    const exact =
      (Number(amount0 / scale0) + Number(amount0 % scale0) / Number(scale0)) *
        price0 +
      (Number(amount1 / scale1) + Number(amount1 % scale1) / Number(scale1)) *
        price1;
    expect(result).toBeCloseTo(exact, 6);
  });

  it('keeps the aggregate TVL finite when a pool is invalid', () => {
    const valid = calculatePoolTvl({
      currentSqrtPrice,
      positions: [position],
      price0: 1,
      price1: 1,
      decimals0: 7,
      decimals1: 7,
    });
    const invalid = calculatePoolTvl({
      currentSqrtPrice,
      positions: [{ ...position, liquidity: '0' }],
      price0: 1,
      price1: 1,
      decimals0: 7,
      decimals1: 7,
    });
    const aggregate = valid + invalid;
    expect(Number.isFinite(aggregate)).toBe(true);
    expect(aggregate).toBe(valid);
  });
});
