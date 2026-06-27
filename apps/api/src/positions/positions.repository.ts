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
        uncollectedFeesToken0: position.feesCollected0,
        uncollectedFeesToken1: position.feesCollected1,
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
