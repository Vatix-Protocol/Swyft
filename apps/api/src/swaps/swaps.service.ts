import { Injectable } from '@nestjs/common';
import { getSwapQuote } from '@swyft/sdk';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { SwapQuoteRequestDto } from './dto/swap-quote-request.dto';
import { SwapQuoteResponseDto } from './dto/swap-quote-response.dto';
import {
  SwapErrorCode,
  SwapQuoteResult,
  SwapSnapshot,
  SwapsQuery,
} from './swap.types';
import { SwapsRepository } from './swaps.repository';
import { PoolDetail, PoolsService } from '../pools/pools.service';
import {
  BusinessRuleViolationException,
  InvalidInputException,
  ResourceNotFoundException,
  SlippageExceededException,
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

  constructor(
    private readonly swapsRepository: SwapsRepository,
    private readonly poolsService: PoolsService,
  ) {}

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
   * Estimates a swap quote by walking the pool's tick ladder (same
   * tick-crossing simulation as the SDK's `getSwapQuote`), so priceImpact
   * reflects real liquidity depth instead of always being 0.
   */
  async getQuote(dto: SwapQuoteRequestDto): Promise<SwapQuoteResponseDto> {
    const pool = await this.poolsService.findPoolById(dto.poolId);
    if (!pool) {
      throw new ResourceNotFoundException('Pool', dto.poolId);
    }

    const zeroForOne = this.resolveDirection(pool, dto.tokenIn, dto.tokenOut);
    const price = this.spotPrice(pool.currentSqrtPrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BusinessRuleViolationException(
        `Pool ${dto.poolId} has no valid price yet`,
      );
    }

    const tokenInDecimals = zeroForOne
      ? pool.token0.decimals
      : pool.token1.decimals;
    const tokenOutDecimals = zeroForOne
      ? pool.token1.decimals
      : pool.token0.decimals;
    const amountInBase = this.toBaseUnits(dto.amountIn, tokenInDecimals);
    if (amountInBase <= 0n) {
      throw new InvalidInputException('amountIn must be greater than zero');
    }

    const ticks = await this.poolsService.getPoolTicks(dto.poolId);

    let result;
    try {
      result = getSwapQuote({
        poolState: {
          poolAddress: pool.id,
          sqrtPrice: pool.currentSqrtPrice,
          currentTick: pool.currentTick,
          liquidity: pool.totalLiquidity,
          feeTier: pool.feeTier,
          token0: pool.token0.address,
          token1: pool.token1.address,
          ticks: ticks.map((tick) => ({
            tick: tick.tickIndex,
            liquidityNet: tick.liquidityNet,
            liquidityGross: tick.liquidityGross,
            feeGrowthOutside: '0',
          })),
        },
        tokenIn: dto.tokenIn,
        amountIn: amountInBase,
        slippage: dto.slippageBps,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'quote failed';
      throw new BusinessRuleViolationException(message);
    }

    const amountOut = this.fromBaseUnits(
      BigInt(result.amountOut),
      tokenOutDecimals,
    );
    const lpFee = this.fromBaseUnits(BigInt(result.fee), tokenInDecimals);
    const minimumReceived = this.fromBaseUnits(
      BigInt(result.minimumReceived),
      tokenOutDecimals,
    );
    const amountInFloat = Number.parseFloat(dto.amountIn);
    const executionPrice =
      amountInFloat > 0 ? Number(amountOut) / amountInFloat : 0;

    return {
      amountOut,
      priceImpact: result.priceImpact,
      lpFee,
      minimumReceived,
      executionPrice: executionPrice.toFixed(7),
    };
  }

  /** Converts a decimal string amount into an integer base-units bigint. */
  private toBaseUnits(amount: string, decimals: number): bigint {
    const [whole, frac = ''] = amount.split('.');
    const paddedFrac = (frac + '0'.repeat(decimals)).slice(0, decimals);
    return (
      BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(paddedFrac || '0')
    );
  }

  /** Converts an integer base-units bigint into a decimal string amount. */
  private fromBaseUnits(amount: bigint, decimals: number): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const frac = (amount % divisor)
      .toString()
      .padStart(decimals, '0')
      .replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  }

  /** Returns true for token0->token1, false for token1->token0. */
  private resolveDirection(
    pool: PoolDetail,
    tokenIn: string,
    tokenOut: string,
  ): boolean {
    const token0 = pool.token0.address;
    const token1 = pool.token1.address;
    if (tokenIn === token0 && tokenOut === token1) return true;
    if (tokenIn === token1 && tokenOut === token0) return false;
    throw new InvalidInputException(
      `tokenIn/tokenOut must be pool ${pool.id}'s tokens (${token0}, ${token1})`,
    );
  }

  /** Spot price of token1 per token0, decoded from the Q64.96 sqrt price. */
  private spotPrice(currentSqrtPrice: string): number {
    const sqrtPrice = Number(currentSqrtPrice) / 2 ** 96;
    return sqrtPrice * sqrtPrice;
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
