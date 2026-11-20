import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PositionsListResult,
  PositionsQuery,
  PositionSnapshot,
  PositionStatus,
  PositionStatusFilter,
} from './position.types';
import { toScaledBigInt } from '../common/decimal';

/** Cap on rows fetched per bulk-by-wallet lookup — a portfolio overview, not a paginated feed. */
const BULK_POSITIONS_LIMIT = 500;

/** Cap on rows fetched per event type before merging/paginating an activity feed. */
const ACTIVITY_FETCH_LIMIT = 200;

/**
 * Computes a position's share of pool TVL as a percentage string, using
 * integer (BigInt) arithmetic. Returns null when liquidity or TVL is missing
 * or TVL is zero, so a broken row is never reported as a 0 percent share.
 */
function computeShareOfTvl(
  liquidity: unknown,
  tvl: unknown,
): string | null {
  const scaledLiquidity = toScaledBigInt(liquidity);
  const scaledTvl = toScaledBigInt(tvl);
  if (scaledLiquidity === null || scaledTvl === null) return null;
  if (scaledTvl === 0n) return null;
  // percentage = liquidity / tvl * 100, computed with 6 decimal places.
  const PRECISION = 6n;
  const scaled = (scaledLiquidity * 100n * 10n ** PRECISION) / scaledTvl;
  const whole = scaled / 10n ** PRECISION;
  const fraction = (scaled % 10n ** PRECISION)
    .toString()
    .padStart(Number(PRECISION), '0')
    .replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

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
      where: { address: { in: Array.from(tokenAddresses) } },
    });
    const tokenSymbolMap = new Map(
      tokens.map((t) => [t.address.toLowerCase(), t.symbol]),
    );

    return positions.map((position) => {
      const pool = position.pool;
      const token0Symbol =
        tokenSymbolMap.get(pool.token0Address.toLowerCase()) ?? 'UNKNOWN';
      const token1Symbol =
        tokenSymbolMap.get(pool.token1Address.toLowerCase()) ?? 'UNKNOWN';

      const shareOfTvl = computeShareOfTvl(position.liquidity, pool.tvl);

      return {
        id: position.id,
        poolId: position.poolId,
        ownerWallet: position.ownerAddress,
        token0Symbol,
        token1Symbol,
        liquidity: position.liquidity,
        currentPrice: position.currentPrice,
        shareOfTvl,
        status: (position.closedAt ? 'closed' : 'active') as PositionStatus,
        createdAt: position.createdAt.getTime(),
        closedAt: position.closedAt ? position.closedAt.getTime() : null,
      };
    });
  }
}
