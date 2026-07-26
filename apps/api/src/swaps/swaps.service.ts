import { Injectable } from '@nestjs/common';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { GetSwapQuoteQueryDto } from './dto/get-swap-quote-query.dto';
import {
  SwapErrorCode,
  SwapQuoteResult,
  SwapSnapshot,
  SwapsQuery,
} from './swap.types';
import { SwapsRepository } from './swaps.repository';
import {
  SlippageExceededException,
  UnknownTokenException,
} from '../request-validation/http.exceptions';

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
        err.message.includes(SwapErrorCode.SLIPPAGE_EXCEEDED)
      ) {
        throw new SlippageExceededException();
      }
      throw err;
    } finally {
      this._isLoading = false;
    }
  }

  /**
   * Validate both tokens against the registry, then return a quote for the pair.
   * Unknown addresses yield HTTP 400 with code UNKNOWN_TOKEN.
   */
  async getQuote(query: GetSwapQuoteQueryDto): Promise<SwapQuoteResult> {
    const tokenInAddr = query.tokenIn.trim();
    const tokenOutAddr = query.tokenOut.trim();
    const amountIn = query.amountIn.trim();
    const slippageBps = query.slippageBps ?? 50;

    const [tokenIn, tokenOut] = await Promise.all([
      this.swapsRepository.findTokenByAddress(tokenInAddr),
      this.swapsRepository.findTokenByAddress(tokenOutAddr),
    ]);

    if (!tokenIn) {
      throw new UnknownTokenException(tokenInAddr);
    }
    if (!tokenOut) {
      throw new UnknownTokenException(tokenOutAddr);
    }

    const pool = await this.swapsRepository.findPoolByTokenPair(
      tokenIn.address,
      tokenOut.address,
    );

    const amountInNum = Number.parseFloat(amountIn);
    const safeAmountIn =
      Number.isFinite(amountInNum) && amountInNum > 0 ? amountInNum : 0;

    let executionPrice = 0;
    if (pool?.currentPrice) {
      const poolPrice = Number.parseFloat(pool.currentPrice);
      if (Number.isFinite(poolPrice) && poolPrice > 0) {
        const tokenInIsToken0 =
          pool.token0Address.toLowerCase() === tokenIn.address.toLowerCase();
        executionPrice = tokenInIsToken0 ? poolPrice : 1 / poolPrice;
      }
    }

    const amountOutNum = safeAmountIn * executionPrice;
    const minimumReceivedNum =
      amountOutNum * (1 - Math.min(slippageBps, 10000) / 10000);

    return {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      tokenInSymbol: tokenIn.symbol,
      tokenOutSymbol: tokenOut.symbol,
      amountIn,
      amountOut: Number.isFinite(amountOutNum) ? String(amountOutNum) : '0',
      executionPrice: Number.isFinite(executionPrice)
        ? String(executionPrice)
        : '0',
      minimumReceived: Number.isFinite(minimumReceivedNum)
        ? String(minimumReceivedNum)
        : '0',
      priceImpact: 0,
      poolId: pool?.id ?? null,
      slippageBps,
    };
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

export type { SwapsListResponse, SwapQuoteResult };
