/**
 * SDK liquidity math vs shared contract fixtures (`fixtures/cl-math-vectors.json`).
 *
 * tick_to_sqrt_price vectors match cl-pool's linear approximation.
 * amounts_for_liquidity vectors pin @swyft/sdk position-math outputs.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Q96,
  getAmountsForLiquidity,
  tickToSqrtPriceX96,
} from '../position-math';

interface TickVector {
  tick: number;
  sqrtPriceX96: string;
}

interface AmountsVector {
  name: string;
  sqrtPriceX96: string;
  sqrtPriceLowerX96: string;
  sqrtPriceUpperX96: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

interface ClMathFixtures {
  Q96: string;
  tick_to_sqrt_price: TickVector[];
  amounts_for_liquidity: AmountsVector[];
}

function loadFixtures(): ClMathFixtures {
  // Prefer monorepo root fixtures/ (shared with contracts); fall back to local copy.
  const candidates = [
    path.resolve(__dirname, '../../../../fixtures/cl-math-vectors.json'),
    path.resolve(__dirname, './fixtures/cl-math-vectors.json'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as ClMathFixtures;
    }
  }
  throw new Error('cl-math-vectors.json not found');
}

const fixtures = loadFixtures();

describe('SDK liquidity math matches contract fixtures', () => {
  it('shares the same Q96 constant', () => {
    expect(Q96.toString()).toBe(fixtures.Q96);
  });

  it('passes at least 3 tick_to_sqrt_price fixture vectors', () => {
    expect(fixtures.tick_to_sqrt_price.length).toBeGreaterThanOrEqual(3);

    for (const vector of fixtures.tick_to_sqrt_price) {
      expect(tickToSqrtPriceX96(vector.tick).toString()).toBe(vector.sqrtPriceX96);
    }
  });

  it('passes at least 3 amounts_for_liquidity fixture vectors', () => {
    expect(fixtures.amounts_for_liquidity.length).toBeGreaterThanOrEqual(3);

    for (const vector of fixtures.amounts_for_liquidity) {
      const { amount0, amount1 } = getAmountsForLiquidity({
        sqrtPriceX96: BigInt(vector.sqrtPriceX96),
        sqrtPriceLowerX96: BigInt(vector.sqrtPriceLowerX96),
        sqrtPriceUpperX96: BigInt(vector.sqrtPriceUpperX96),
        liquidity: BigInt(vector.liquidity),
      });
      expect({ name: vector.name, amount0: amount0.toString(), amount1: amount1.toString() }).toEqual({
        name: vector.name,
        amount0: vector.amount0,
        amount1: vector.amount1,
      });
    }
  });
});
