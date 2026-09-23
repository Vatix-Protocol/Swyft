import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PositionsListResult,
  PositionsQuery,
  PositionSnapshot,
  PositionStatus,
  PositionStatusFilter,
} from './position.types';

/** Cap on rows fetched per bulk-by-wallet lookup — a portfolio overview, not a paginated feed. */
const BULK_POSITIONS_LIMIT = 500;

/** Cap on rows fetched per event type before merging/paginating an activity feed. */
const ACTIVITY_FETCH_LIMIT = 200;

export interface LpActivityEntry {
  id: string;
  type: 'mint' | 'burn' | 'fee_collection';
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  txHash: string;
  walletAddress: string;
  timestamp: number;
}

@Injectable()
export class PositionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Merges real on-chain PositionMinted, PositionBurned and FeesCollected
   * events indexed for a wallet into a single chronological activity feed.
   */
  async listActivityByWallet(
    walletAddress: string,
    query: { pool?: string; page: number; limit: number },
  ): Promise<{ items: LpActivityEntry[]; total: number }> {
    const wallet = walletAddress.toLowerCase();
    const poolFilter = query.pool?.trim();

    const mintedWhere: any = {
      owner: { equals: wallet, mode: 'insensitive' },
    };
    const burnedWhere: any = {
      owner: { equals: wallet, mode: 'insensitive' },
    };
    const feesWhere: any = {
      recipient: { equals: wallet, mode: 'insensitive' },
    };
    if (poolFilter) {
      mintedWhere.poolId = { equals: poolFilter, mode: 'insensitive' };
      burnedWhere.poolId = { equals: poolFilter, mode: 'insensitive' };
      feesWhere.poolId = { equals: poolFilter, mode: 'insensitive' };
    }

    const [minted, burned, fees] = await Promise.all([
      this.prisma.positionMinted.findMany({
        where: mintedWhere,
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_FETCH_LIMIT,
      }),
      this.prisma.positionBurned.findMany({
        where: burnedWhere,
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_FETCH_LIMIT,
      }),
      this.prisma.feesCollected.findMany({
        where: feesWhere,
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_FETCH_LIMIT,
      }),
    ]);

    const poolIds = [
      ...new Set([...minted, ...burned, ...fees].map((e) => e.poolId)),
    ];
    const pools = await this.prisma.pool.findMany({
      where: { id: { in: poolIds } },
      select: { id: true, token0Address: true, token1Address: true },
    });
    const tokenAddresses = new Set<string>();
    for (const pool of pools) {
      tokenAddresses.add(pool.token0Address);
      tokenAddresses.add(pool.token1Address);
    }
    const tokens = await this.prisma.token.findMany({
      where: { address: { in: Array.from(tokenAddresses) } },
    });
    const tokenSymbolMap = new Map(
      tokens.map((t) => [t.address.toLowerCase(), t.symbol]),
    );
    const poolTokenSymbols = new Map(
      pools.map((p) => [
        p.id,
        {
          token0Symbol:
            tokenSymbolMap.get(p.token0Address.toLowerCase()) ?? 'UNKNOWN',
          token1Symbol:
            tokenSymbolMap.get(p.token1Address.toLowerCase()) ?? 'UNKNOWN',
        },
      ]),
    );
    const symbolsFor = (poolId: string) =>
      poolTokenSymbols.get(poolId) ?? {
        token0Symbol: 'UNKNOWN',
        token1Symbol: 'UNKNOWN',
      };

    const entries: LpActivityEntry[] = [
      ...minted.map((e) => ({
        id: e.eventId,
        type: 'mint' as const,
        poolId: e.poolId,
        ...symbolsFor(e.poolId),
        amount0: e.amount0,
        amount1: e.amount1,
        txHash: e.eventId,
        walletAddress: e.owner,
        timestamp: e.createdAt.getTime(),
      })),
      ...burned.map((e) => ({
        id: e.eventId,
        type: 'burn' as const,
        poolId: e.poolId,
        ...symbolsFor(e.poolId),
        amount0: e.amount0,
        amount1: e.amount1,
        txHash: e.eventId,
        walletAddress: e.owner,
        timestamp: e.createdAt.getTime(),
      })),
      ...fees.map((e) => ({
        id: e.eventId,
        type: 'fee_collection' as const,
        poolId: e.poolId,
        ...symbolsFor(e.poolId),
        amount0: e.amount0,
        amount1: e.amount1,
        txHash: e.eventId,
        walletAddress: e.recipient,
        timestamp: e.createdAt.getTime(),
      })),
    ].sort((a, b) => b.timestamp - a.timestamp);

    const total = entries.length;
    const skip = (query.page - 1) * query.limit;
    const items = entries.slice(skip, skip + query.limit);

    return { items, total };
  }

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

    const items = await this.toSnapshots(positions);
    return { items, total };
  }

  /**
   * Fetches positions for many wallets in one round trip. Returns a snapshot
   * list per wallet (lowercased address) plus each wallet's total matching
   * count, capped at BULK_POSITIONS_LIMIT rows overall since this is a
   * portfolio-overview lookup rather than a paginated feed.
   */
  async listPositionsByWallets(
    walletAddresses: string[],
    status: PositionStatusFilter,
  ): Promise<Map<string, { items: PositionSnapshot[]; total: number }>> {
    const wallets = [...new Set(walletAddresses.map((w) => w.toLowerCase()))];
    const result = new Map<
      string,
      { items: PositionSnapshot[]; total: number }
    >();
    for (const wallet of wallets) {
      result.set(wallet, { items: [], total: 0 });
    }

    if (wallets.length === 0) return result;

    const where: any = {
      ownerAddress: { in: wallets, mode: 'insensitive' },
    };
    if (status === 'active') {
      where.closedAt = null;
    } else if (status === 'closed') {
      where.closedAt = { not: null };
    }

    const [counts, positions] = await Promise.all([
      this.prisma.position.groupBy({
        by: ['ownerAddress'],
        where,
        _count: { _all: true },
      }),
      this.prisma.position.findMany({
        where,
        include: { pool: true },
        orderBy: { createdAt: 'desc' },
        take: BULK_POSITIONS_LIMIT,
      }),
    ]);

    for (const c of counts) {
      const wallet = c.ownerAddress.toLowerCase();
      const entry = result.get(wallet);
      if (entry) entry.total = c._count._all;
    }

    const snapshots = await this.toSnapshots(positions);
    for (const snapshot of snapshots) {
      const entry = result.get(snapshot.ownerWallet.toLowerCase());
      entry?.items.push(snapshot);
    }

    return result;
  }

  /**
   * Maps raw position rows (with their pool relation) into PositionSnapshot
   * objects, resolving token symbols and unclaimed fees without N+1 queries.
   * Shared by both the single-wallet and bulk-by-wallet lookups above.
   */
  private async toSnapshots(positions: any[]): Promise<PositionSnapshot[]> {
    if (positions.length === 0) return [];

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
    // by these positions so we can compute unclaimed fees per position
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

    return positions.map((position) => {
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

      const rawUnclaimed0 =
        totalPoolFees0 * liquidityShare - collected.amount0 * liquidityShare;
      const rawUnclaimed1 = collected.amount1 * liquidityShare;

      const uncollectedFeesToken0 = String(Math.max(0, rawUnclaimed0));
      const uncollectedFeesToken1 = String(Math.max(0, rawUnclaimed1));

      return {
        id: position.id,
        ownerWallet: position.ownerAddress,
        poolId: position.poolId,
        tokenId: position.tokenId,
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
  }
}
