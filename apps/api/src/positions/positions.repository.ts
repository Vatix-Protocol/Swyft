import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PositionsListResult,
  PositionsQuery,
  PositionSnapshot,
  PositionStatus,
} from './position.types';

@Injectable()
export class PositionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPositionsByWallet(
    walletAddress: string,
    query: PositionsQuery,
  ): Promise<PositionsListResult> {
    const wallet = walletAddress.toLowerCase();
    const poolFilter = query.pool?.trim();

    const where: any = {
      ownerAddress: { equals: wallet, mode: 'insensitive' },
    };

    if (query.status === 'active') {
      where.closedAt = null;
    } else if (query.status === 'closed') {
      where.closedAt = { not: null };
    }

    if (poolFilter) {
      where.poolId = { equals: poolFilter, mode: 'insensitive' };
    }

    const total = await this.prisma.position.count({ where });

    const skip = (query.page - 1) * query.limit;
    const positions = await this.prisma.position.findMany({
      where,
      include: {
        pool: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: query.limit,
    });

    if (positions.length === 0) {
      return { items: [], total };
    }

    // Resolve token symbols
    const tokenAddresses = new Set<string>();
    for (const position of positions) {
      tokenAddresses.add(position.pool.token0Address);
      tokenAddresses.add(position.pool.token1Address);
    }

    const tokens = await this.prisma.token.findMany({
      where: {
        address: {
          in: Array.from(tokenAddresses),
        },
      },
    });

    const tokenSymbolMap = new Map(
      tokens.map((t) => [t.address.toLowerCase(), t.symbol]),
    );

    // Pre-fetch swaps and fees-collected for every distinct pool referenced
    // by this page of positions so we can compute unclaimed fees per position
    // without N+1 queries.
    const poolIds = [...new Set(positions.map((p) => p.poolId))];

    const [swapsByPool, feesCollectedByPool] = await Promise.all([
      this.prisma.swap.findMany({
        where: { poolId: { in: poolIds } },
        select: { poolId: true, amount0: true },
      }),
      this.prisma.feesCollected.findMany({
        where: { poolId: { in: poolIds } },
        select: { poolId: true, amount0: true, amount1: true },
      }),
    ]);

    // Aggregate total |amount0| swapped per pool (proxy for fee base).
    const poolSwapVolume = new Map<string, number>();
    for (const s of swapsByPool) {
      poolSwapVolume.set(
        s.poolId,
        (poolSwapVolume.get(s.poolId) ?? 0) + Math.abs(Number(s.amount0)),
      );
    }

    // Aggregate total fees collected per pool (already-claimed portion).
    const poolFeesCollected = new Map<
      string,
      { amount0: number; amount1: number }
    >();
    for (const f of feesCollectedByPool) {
      const cur = poolFeesCollected.get(f.poolId) ?? {
        amount0: 0,
        amount1: 0,
      };
      cur.amount0 += Math.abs(Number(f.amount0));
      cur.amount1 += Math.abs(Number(f.amount1));
      poolFeesCollected.set(f.poolId, cur);
    }

    const items: PositionSnapshot[] = positions.map((position) => {
      const token0Symbol =
        tokenSymbolMap.get(position.pool.token0Address.toLowerCase()) ??
        'UNKNOWN';
      const token1Symbol =
        tokenSymbolMap.get(position.pool.token1Address.toLowerCase()) ??
        'UNKNOWN';

      const poolPrice = parseFloat(position.pool.currentPrice ?? '0');
      const status: PositionStatus = position.closedAt ? 'closed' : 'active';

      const posLiquidity = parseFloat(position.liquidity) || 0;
      const poolLiquidity = parseFloat(position.pool.liquidity) || 0;
      const poolTvl = parseFloat(position.pool.tvl) || 0;
      const currentValueUsd =
        poolLiquidity > 0 ? (posLiquidity / poolLiquidity) * poolTvl : 0;

      // Compute unclaimed fees for this position.
      // The position's liquidity share determines its proportion of total pool
      // fees. We estimate total pool fees from swap volume × feeTier (ppm) and
      // subtract already-collected amounts.
      const liquidityShare =
        poolLiquidity > 0 ? posLiquidity / poolLiquidity : 0;
      const feeTierPpm = position.pool.feeTier / 1_000_000;
      const poolVolume = poolSwapVolume.get(position.poolId) ?? 0;
      const totalPoolFees0 = poolVolume * feeTierPpm;

      const collected = poolFeesCollected.get(position.poolId) ?? {
        amount0: 0,
        amount1: 0,
      };

      const rawUnclaimed0 = totalPoolFees0 * liquidityShare - collected.amount0 * liquidityShare;
      const rawUnclaimed1 = collected.amount1 * liquidityShare;

      const uncollectedFeesToken0 = String(Math.max(0, rawUnclaimed0));
      const uncollectedFeesToken1 = String(Math.max(0, rawUnclaimed1));

      return {
        id: position.id,
        ownerWallet: position.ownerAddress,
        poolId: position.poolId,
        token0: token0Symbol,
        token1: token1Symbol,
        lowerTick: position.lowerTick,
        upperTick: position.upperTick,
        liquidity: position.liquidity,
        currentValueUsd,
        uncollectedFeesToken0,
        uncollectedFeesToken1,
        createdAt: position.createdAt.getTime(),
        closedAt: position.closedAt ? position.closedAt.getTime() : null,
        status,
        poolCurrentPrice: poolPrice,
      };
    });

    return {
      items,
      total,
    };
  }
}
