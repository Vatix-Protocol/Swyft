import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PoolListQuery, PoolListResult, PoolSnapshot } from './pool.types';

type PoolStatePatch = {
  currentPrice?: string;
};

export interface TickData {
  tickIndex: number;
  liquidityNet: string;
  liquidityGross: string;
  feeGrowthOutside0X128: string;
  feeGrowthOutside1X128: string;
}

@Injectable()
export class PoolsRepository {
  private readonly pools = new Map<string, PoolSnapshot>();

  constructor(private readonly prisma: PrismaService) {}

  async listActivePools(query: PoolListQuery): Promise<PoolListResult> {
    const search = query.search?.trim().toLowerCase();

    const filtered = [...this.pools.values()]
      .filter((pool) => pool.active)
      .filter((pool) => {
        if (!search) return true;
        return (
          pool.token0.toLowerCase().includes(search) ||
          pool.token1.toLowerCase().includes(search)
        );
      });

    const sorted = filtered.sort((a, b) => {
      if (query.orderBy === 'volume') return b.volume24h - a.volume24h;
      if (query.orderBy === 'apr') return b.feeApr - a.feeApr;
      return b.tvl - a.tvl;
    });

    const offset = (query.page - 1) * query.limit;
    const items = sorted.slice(offset, offset + query.limit);

    return {
      items,
      total: sorted.length,
    };
  }

  async upsertPoolState(poolId: string, patch: PoolStatePatch): Promise<void> {
    const existing = this.pools.get(poolId);
    if (!existing) return;

    const currentPrice = patch.currentPrice
      ? Number.parseFloat(patch.currentPrice)
      : existing.currentPrice;

    this.pools.set(poolId, {
      ...existing,
      currentPrice,
      updatedAt: Date.now(),
    });
  }

  async getTicksByPoolId(
    poolId: string,
    lowerTick?: number,
    upperTick?: number,
  ): Promise<TickData[]> {
    return this.prisma.tick.findMany({
      where: {
        poolId,
        ...(lowerTick !== undefined || upperTick !== undefined
          ? {
              tickIndex: {
                ...(lowerTick !== undefined && { gte: lowerTick }),
                ...(upperTick !== undefined && { lte: upperTick }),
              },
            }
          : {}),
      },
      orderBy: { tickIndex: 'asc' },
      select: {
        tickIndex: true,
        liquidityNet: true,
        liquidityGross: true,
        feeGrowthOutside0X128: true,
        feeGrowthOutside1X128: true,
      },
    });
  }
}
