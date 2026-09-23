import { Injectable } from '@nestjs/common';
import { Pool } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PoolListQuery, PoolListResult, PoolSnapshot, ClPoolView } from './pool.types';

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

/**
 * Repository that owns the pool source of truth (SoT).
 *
 * Invariant (see CONTRACTS.md): the `pool` record is authoritative for
 * liquidity and state. Any `cl-pool` data is a *derived view* computed from
 * the pool SoT and MUST NOT be treated as an independent authority.
 */
@Injectable()
export class PoolsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActivePools(query: PoolListQuery): Promise<PoolListResult> {
    const search = query.search?.trim().toLowerCase();
    const includeInactive = query.includeInactive === true;

    const pools = await this.prisma.pool.findMany({
      where: {
        ...(!includeInactive ? { active: true } : {}),
        ...(search
          ? {
              OR: [
                { id: { contains: search, mode: 'insensitive' } },
                { token0Address: { contains: search, mode: 'insensitive' } },
                { token1Address: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    });
    const snapshots = pools.map((pool) => this.toSnapshot(pool));
    const sorted = snapshots.sort((a, b) => {
      const primary =
        query.orderBy === 'volume'
          ? b.volume24h - a.volume24h
          : query.orderBy === 'apr'
            ? b.feeApr - a.feeApr
            : b.tvl - a.tvl;
      // Tie-break deterministically so pagination is stable across requests.
      return primary !== 0 ? primary : a.id.localeCompare(b.id);
    });

    const offset = (query.page - 1) * query.limit;
    const items = sorted.slice(offset, offset + query.limit);

    return {
      items,
      total: snapshots.length,
    };
  }

  /**
   * Derive the cl-pool view from the authoritative pool record.
   *
   * This is the single SoT path for cl-pool data: callers must go through the
   * pool record rather than reading cl-pool state from a parallel source.
   */
  async findClPoolView(poolId: string): Promise<ClPoolView | null> {
    const pool = await this.prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) {
      return null;
    }
    return this.deriveClPoolView(pool);
  }

  private deriveClPoolView(pool: Pool): ClPoolView {
    return {
      poolId: pool.id,
      // cl-pool fields are derived from the pool SoT; no parallel authority.
      liquidity: pool.liquidity,
      tickSpacing: pool.tickSpacing,
      currentTick: pool.currentTick,
      sqrtPriceX96: pool.sqrtPriceX96,
      derivedFromPool: true,
    };
  }

  /**
   * Validates a raw sqrtPriceX96 string.
   * A valid sqrt price must be a finite positive integer (Q64.96 fixed-point).
   * Zero is rejected because it encodes an undefined price.
   */
  static isValidSqrtPrice(value: string | undefined | null): boolean {
    if (!value || value.trim() === '') return false;
    const n = BigInt(value.trim());
    return n > 0n;
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
      active: pool.active,
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
