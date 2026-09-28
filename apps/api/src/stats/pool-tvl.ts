import {
  getAmountsForLiquidity,
  tickToSqrtPriceX96,
} from '@swyft/sdk/position-math';

export interface TvlPosition {
  lowerTick: number;
  upperTick: number;
  liquidity: string;
}

export interface PoolTvlInput {
  currentSqrtPrice: string;
  positions: readonly TvlPosition[];
  price0: number;
  price1: number;
  decimals0: number;
  decimals1: number;
}

export function calculatePoolTvl({
  currentSqrtPrice,
  positions,
  price0,
  price1,
  decimals0,
  decimals1,
}: PoolTvlInput): number {
  if (
    !Number.isFinite(price0) ||
    price0 <= 0 ||
    !Number.isFinite(price1) ||
    price1 <= 0
  ) {
    throw new Error('Pool USD prices are invalid');
  }
  if (
    !Number.isInteger(decimals0) ||
    decimals0 < 0 ||
    decimals0 > 18 ||
    !Number.isInteger(decimals1) ||
    decimals1 < 0 ||
    decimals1 > 18
  ) {
    throw new Error('Pool token decimals are invalid');
  }

  let sqrtPriceX96: bigint;
  try {
    sqrtPriceX96 = BigInt(currentSqrtPrice);
  } catch {
    throw new Error('Pool sqrt price is invalid');
  }
  if (sqrtPriceX96 <= 0n) throw new Error('Pool sqrt price is invalid');

  let reserve0 = 0n;
  let reserve1 = 0n;
  for (const position of positions) {
    if (
      !Number.isInteger(position.lowerTick) ||
      !Number.isInteger(position.upperTick) ||
      position.lowerTick >= position.upperTick
    ) {
      throw new Error('Indexed position tick range is invalid');
    }

    let liquidity: bigint;
    try {
      if (!/^\d+$/.test(position.liquidity)) {
        throw new Error('invalid liquidity');
      }
      liquidity = BigInt(position.liquidity);
    } catch {
      throw new Error('Indexed position liquidity is invalid');
    }

    const amounts = getAmountsForLiquidity({
      sqrtPriceX96,
      sqrtPriceLowerX96: tickToSqrtPriceX96(position.lowerTick),
      sqrtPriceUpperX96: tickToSqrtPriceX96(position.upperTick),
      liquidity,
    });
    reserve0 += amounts.amount0;
    reserve1 += amounts.amount1;
  }

  const tvl =
    (Number(reserve0) / 10 ** decimals0) * price0 +
    (Number(reserve1) / 10 ** decimals1) * price1;
  if (!Number.isFinite(tvl) || tvl < 0) {
    throw new Error('Computed pool TVL is invalid');
  }
  return tvl;
}
