import { Injectable } from '@nestjs/common';
import {
  PositionsListResult,
  PositionsQuery,
  PositionSnapshot,
} from './position.types';

@Injectable()
export class PositionsRepository {
  private readonly positions = new Map<string, PositionSnapshot>();

  async listPositionsByWallet(
    walletAddress: string,
    query: PositionsQuery,
  ): Promise<PositionsListResult> {
    const wallet = walletAddress.toLowerCase();
    const poolFilter = query.pool?.toLowerCase();

    const filtered = [...this.positions.values()]
      .filter((position) => position.ownerWallet.toLowerCase() === wallet)
      .filter((position) => {
        if (query.status === 'all') return true;
        return position.status === query.status;
      })
      .filter((position) => {
        if (!poolFilter) return true;
        return position.poolId.toLowerCase() === poolFilter;
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const offset = (query.page - 1) * query.limit;
    const items = filtered.slice(offset, offset + query.limit);

    return {
      items,
      total: filtered.length,
    };
  }
}
