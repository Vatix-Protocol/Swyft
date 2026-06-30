import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SwapSnapshot, SwapsListResult, SwapsQuery } from './swap.types';

@Injectable()
export class SwapsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listSwaps(query: SwapsQuery): Promise<SwapsListResult> {
    const poolId = query.poolId?.trim();
    const wallet = query.wallet?.trim();

    const where: any = {};

    if (poolId) {
      where.poolId = { equals: poolId, mode: 'insensitive' };
    }

    if (wallet) {
      where.OR = [
        { senderAddress: { equals: wallet, mode: 'insensitive' } },
        { recipientAddress: { equals: wallet, mode: 'insensitive' } },
      ];
    }

    const total = await this.prisma.swap.count({ where });

    const skip = (query.page - 1) * query.limit;
    const swaps = await this.prisma.swap.findMany({
      where,
      include: {
        pool: true,
      },
      orderBy: {
        timestamp: 'desc',
      },
      skip,
      take: query.limit,
    });

    if (swaps.length === 0) {
      return { items: [], total };
    }

    // Resolve token symbols for the pools
    const tokenAddresses = new Set<string>();
    for (const swap of swaps) {
      tokenAddresses.add(swap.pool.token0Address);
      tokenAddresses.add(swap.pool.token1Address);
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

    const items: SwapSnapshot[] = swaps.map((swap) => {
      const token0Symbol =
        tokenSymbolMap.get(swap.pool.token0Address.toLowerCase()) ?? 'UNKNOWN';
      const token1Symbol =
        tokenSymbolMap.get(swap.pool.token1Address.toLowerCase()) ?? 'UNKNOWN';

      // priceAtSwap: price = (Number(sqrtPriceAfter) / 2^96)^2
      const sqrtPrice = Number(swap.sqrtPriceAfter);
      const price = Math.pow(sqrtPrice / Math.pow(2, 96), 2);
      const priceAtSwap = Number.isFinite(price) ? price.toString() : '0';

      return {
        id: swap.id,
        poolId: swap.poolId,
        token0Symbol,
        token1Symbol,
        amount0: swap.amount0,
        amount1: swap.amount1,
        priceAtSwap,
        feeAmount: swap.feeAmount,
        txHash: swap.transactionHash,
        walletAddress: swap.senderAddress,
        timestamp: swap.timestamp.getTime(),
      };
    });

    return {
      items,
      total,
    };
  }
}
