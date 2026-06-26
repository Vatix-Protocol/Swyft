import { Injectable } from '@nestjs/common';
import { Pool } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

  async listActivePools(query: PoolListQuery): Promise<PoolListResult> {
    const search = query.search?.trim().toLowerCase();

    const pools = await this.prisma.pool.findMany({
      where: search
        ? {
            OR: [
              { token0Address: { contains: search, mode: 'insensitive' } },
              { token1Address: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
    });
    const snapshots = pools.map((pool) => this.toSnapshot(pool));
    const sorted = snapshots.sort((a, b) => {
      if (query.orderBy === 'volume') return b.volume24h - a.volume24h;
      if (query.orderBy === 'apr') return b.feeApr - a.feeApr;
      return b.tvl - a.tvl;
    });

    const offset = (query.page - 1) * query.limit;
    const items = sorted.slice(offset, offset + query.limit);

    return {
      items,
      total: snapshots.length,
    };
  }

  async upsertPoolState(poolId: string, patch: PoolStatePatch): Promise<void> {
    if (patch.currentPrice === undefined) return;

    const currentPrice = Number.parseFloat(patch.currentPrice);
    if (!Number.isFinite(currentPrice) || currentPrice < 0) return;

    await this.prisma.pool
      .update({
        where: { id: poolId },
        data: { currentPrice: patch.currentPrice },
      })
      .catch((error: { code?: string }) => {
        // State updates may arrive for a pool that has not been indexed yet.
        // Ignore that race; a later event will create the pool and update it.
        if (error.code !== 'P2025') throw error;
      });
  }

  private toSnapshot(pool: Pool): PoolSnapshot {
    return {
      id: pool.id,
      token0: pool.token0Address,
      token1: pool.token1Address,
      feeTier: String(pool.feeTier),
      tvl: this.asFiniteNumber(pool.tvl),
      volume24h: this.asFiniteNumber(pool.volume24h),
      feeApr: this.asFiniteNumber(pool.feeApr),
      currentPrice: this.asFiniteNumber(pool.currentPrice),
      // Closed pools are deleted from the current schema, so every row is an
      // active pool. This preserves the API contract without transient memory.
      active: true,
      updatedAt: pool.updatedAt.getTime(),
    };
  }

  private asFiniteNumber(value: string | null): number {
    const parsed = Number.parseFloat(value ?? '0');
    return Number.isFinite(parsed) ? parsed : 0;
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

  async poolExists(id: string): Promise<boolean> {
    const count = await this.prisma.pool.count({
      where: { id },
    });
    return count > 0;
  }

  async getPoolDetailById(poolId: string): Promise<any> {
    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
      include: {
        swaps: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
    });

    if (!pool) return null;

    const [token0, token1] = await Promise.all([
      this.prisma.token.findUnique({ where: { address: pool.token0Address } }),
      this.prisma.token.findUnique({ where: { address: pool.token1Address } }),
    ]);

    return {
      pool,
      token0,
      token1,
    };
  }
}
