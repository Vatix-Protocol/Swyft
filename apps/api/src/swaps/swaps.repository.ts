import { Injectable } from '@nestjs/common';
import { SwapSnapshot, SwapsListResult, SwapsQuery } from './swap.types';

@Injectable()
export class SwapsRepository {
  private readonly swaps = new Map<string, SwapSnapshot>();

  async listSwaps(query: SwapsQuery): Promise<SwapsListResult> {
    const pool = query.pool?.toLowerCase();
    const wallet = query.wallet?.toLowerCase();

    const filtered = [...this.swaps.values()]
      .filter((swap) => {
        if (!pool) return true;
        return swap.poolId.toLowerCase() === pool;
      })
      .filter((swap) => {
        if (!wallet) return true;
        return swap.walletAddress.toLowerCase() === wallet;
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    const offset = (query.page - 1) * query.limit;
    const items = filtered.slice(offset, offset + query.limit);

    return {
      items,
      total: filtered.length,
    };
  }
}
