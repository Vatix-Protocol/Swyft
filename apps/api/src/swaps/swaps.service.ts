import { Injectable } from '@nestjs/common';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { SwapErrorCode, SwapSnapshot, SwapsQuery } from './swap.types';
import { SwapsRepository } from './swaps.repository';
import { SlippageExceededException } from '../request-validation/http.exceptions';

interface SwapResponse {
  id: string;
  poolId: string;
  /** Normalized "TOKEN0/TOKEN1" label for the trading pair. */
  tokenPair: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  priceAtSwap: string;
  /** Fee charged for this swap (expressed in token0 units). */
  feeAmount: string;
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
  isLoading: boolean;
}

@Injectable()
export class SwapsService {
  private _isLoading = false;

  get isLoading(): boolean {
    return this._isLoading;
  }

  constructor(private readonly swapsRepository: SwapsRepository) {}

  async getSwaps(query: GetSwapsQueryDto): Promise<SwapsListResponse> {
    this._isLoading = true;
    try {
      const normalized: SwapsQuery = {
        poolId: query.poolId?.trim() || undefined,
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
        isLoading: false,
      };
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message as string).includes(SwapErrorCode.SLIPPAGE_EXCEEDED)
      ) {
        throw new SlippageExceededException();
      }
      throw err;
    } finally {
      this._isLoading = false;
    }
  }

  private toResponse(swap: SwapSnapshot): SwapResponse {
    return {
      id: swap.id,
      poolId: swap.poolId,
      tokenPair: `${swap.token0Symbol}/${swap.token1Symbol}`,
      token0Symbol: swap.token0Symbol,
      token1Symbol: swap.token1Symbol,
      amount0: swap.amount0,
      amount1: swap.amount1,
      priceAtSwap: swap.priceAtSwap,
      feeAmount: swap.feeAmount,
      transactionHash: swap.txHash,
      walletAddress: swap.walletAddress,
      timestamp: swap.timestamp,
    };
  }
}

export type { SwapsListResponse };
