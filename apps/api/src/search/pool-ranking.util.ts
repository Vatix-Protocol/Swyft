import { SearchPoolResult } from './search.service';

export interface RankablePool extends SearchPoolResult {
  volume24h: string | number;
}

/**
 * Ranks pools by descending 24h volume. Ties are broken by poolId ascending
 * so repeated queries against unchanged data always return the same order.
 */
export function rankPoolsByVolume<T extends RankablePool>(pools: T[]): T[] {
  return [...pools].sort((a, b) => {
    const volumeDiff = Number(b.volume24h) - Number(a.volume24h);
    if (volumeDiff !== 0) {
      return volumeDiff;
    }
    return a.poolId.localeCompare(b.poolId);
  });
}
