import { Injectable } from '@nestjs/common';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { SwapSnapshot, SwapsQuery } from './swap.types';
import { SwapsRepository } from './swaps.repository';

interface SwapResponse {
  id: string;
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  transactionHash: string;
  walletAddress: string;
  timestamp: number;
}

interface SwapsListResponse {
  items: SwapResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class SwapsService {
  constructor(private readonly swapsRepository: SwapsRepository) {}

  async getSwaps(query: GetSwapsQueryDto): Promise<SwapsListResponse> {
    const normalized: SwapsQuery = {
      pool: query.pool?.trim() || undefined,
      wallet: query.wallet?.trim() || undefined,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };

    const { items, total } = await this.swapsRepository.listSwaps(normalized);

    return {
      items: items.map((swap) => this.toResponse(swap)),
      page: normalized.page,
      limit: normalized.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / normalized.limit),
    };
  }

  private toResponse(swap: SwapSnapshot): SwapResponse {
    return {
      id: swap.id,
      poolId: swap.poolId,
      token0Symbol: swap.token0Symbol,
      token1Symbol: swap.token1Symbol,
      amount0: swap.amount0,
      amount1: swap.amount1,
      priceAtSwap: swap.priceAtSwap,
      transactionHash: swap.txHash,
      walletAddress: swap.walletAddress,
      timestamp: swap.timestamp,
    };
  }
}

export type { SwapsListResponse };
