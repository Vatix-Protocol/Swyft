import { getSwapQuote, calculateSwapQuote, EMPTY_QUOTE, isEmptyQuote } from '../quote';
import { PoolState } from '../types';

const Q96 = '79228162514264337593543950336'; // 2^96

function pool(overrides: Partial<PoolState> = {}): PoolState {
  return {
    poolAddress: 'pool',
    sqrtPrice: Q96,
    currentTick: 0,
    liquidity: '1000000000000',
    feeTier: 3000,
    token0: 'token0',
    token1: 'token1',
    ...overrides,
  };
}

describe('getSwapQuote', () => {
  it('quotes token0 to token1 swaps locally', () => {
    const quote = getSwapQuote({
      poolState: pool(),
      tokenIn: 'token0',
      amountIn: '1000000',
      slippage: 50,
    });

    expect(BigInt(quote.amountOut)).toBeGreaterThan(0n);
    expect(quote.fee).toBe('3000');
    expect(BigInt(quote.minimumReceived)).toBeLessThan(BigInt(quote.amountOut));
    expect(BigInt(quote.sqrtPriceLimitX96)).toBeLessThan(BigInt(Q96));
  });

  it('quotes token1 to token0 swaps locally', () => {
    const quote = getSwapQuote({
      poolState: pool(),
      tokenIn: 'token1',
      amountIn: '1000000',
      slippage: 100,
    });

    expect(BigInt(quote.amountOut)).toBeGreaterThan(0n);
    expect(BigInt(quote.sqrtPriceLimitX96)).toBeGreaterThan(BigInt(Q96));
  });

  it('simulates initialized tick crossings', () => {
    const quote = getSwapQuote({
      poolState: {
        ...pool(),
        ticks: [
          {
            tick: -120,
            liquidityNet: '-500000000000',
            liquidityGross: '500000000000',
            feeGrowthOutside: '0',
          },
        ],
      },
      tokenIn: 'token0',
      amountIn: '7000000000',
      slippage: 0,
    });

    expect(BigInt(quote.amountOut)).toBeGreaterThan(0n);
    expect(Number(quote.priceImpact)).toBeGreaterThan(0);
  });

  it('rejects zero liquidity in range', () => {
    expect(() =>
      getSwapQuote({
        poolState: pool({ liquidity: '0' }),
        tokenIn: 'token0',
        amountIn: '100',
        slippage: 0,
      })
    ).toThrow('zero liquidity');
  });

  it('rejects swaps that exceed available liquidity', () => {
    expect(() =>
      getSwapQuote({
        poolState: {
          ...pool({ liquidity: '1', currentTick: -887271 }),
          ticks: [],
        },
        tokenIn: 'token0',
        amountIn: '1000000000000000000000000000000',
        slippage: 0,
      })
    ).toThrow('amount exceeds available liquidity');
  });

  it('rejects invalid token direction', () => {
    expect(() =>
      getSwapQuote({
        poolState: pool(),
        tokenIn: 'not-in-pool',
        amountIn: '100',
        slippage: 0,
      })
    ).toThrow('invalid token direction');
  });

  it('runs typical quotes under 5ms', () => {
    const started = Date.now();
    getSwapQuote({
      poolState: pool(),
      tokenIn: 'token0',
      amountIn: '1000000',
      slippage: 50,
    });

    expect(Date.now() - started).toBeLessThan(5);
  });
});

describe('calculateSwapQuote — empty data handling', () => {
  it('returns EMPTY_QUOTE for empty amountIn string', () => {
    const result = calculateSwapQuote({
      poolId: 'pool',
      tokenInId: 'token0',
      tokenOutId: 'token1',
      amountIn: '',
      slippageBps: 50,
    });
    expect(result).toEqual(EMPTY_QUOTE);
  });

  it('returns EMPTY_QUOTE for zero amountIn', () => {
    const result = calculateSwapQuote({
      poolId: 'pool',
      tokenInId: 'token0',
      tokenOutId: 'token1',
      amountIn: '0',
      slippageBps: 50,
    });
    expect(result).toEqual(EMPTY_QUOTE);
  });

  it('returns EMPTY_QUOTE for negative amountIn', () => {
    const result = calculateSwapQuote({
      poolId: 'pool',
      tokenInId: 'token0',
      tokenOutId: 'token1',
      amountIn: '-5',
      slippageBps: 50,
    });
    expect(result).toEqual(EMPTY_QUOTE);
  });

  it('isEmptyQuote returns true for EMPTY_QUOTE', () => {
    expect(isEmptyQuote(EMPTY_QUOTE)).toBe(true);
  });

  it('isEmptyQuote returns false for a real quote', () => {
    const result = calculateSwapQuote({
      poolId: 'pool',
      tokenInId: 'token0',
      tokenOutId: 'token1',
      amountIn: '100',
      slippageBps: 50,
    });
    expect(isEmptyQuote(result)).toBe(false);
  });
});
