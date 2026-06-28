import { Injectable } from '@nestjs/common';
import { PriceService } from '../price/price.service';
import { GetPositionsQueryDto } from './dto/get-positions-query.dto';
import {
  PositionRangeStatus,
  PositionSnapshot,
  PositionsQuery,
} from './position.types';
import { PositionsRepository } from './positions.repository';

interface PositionResponse {
  id: string;
  poolId: string;
  tokenPair: {
    token0: string;
    token1: string;
  };
  lowerTick: number;
  upperTick: number;
  liquidity: string;
  currentValueUsd: number;
  uncollectedFeesToken0: string;
  uncollectedFeesToken1: string;
  createdAt: number;
  closedAt: number | null;
  status: 'active' | 'closed';
  rangeStatus: PositionRangeStatus | null;
}

interface PositionsListResponse {
  items: PositionResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class PositionsService {
  constructor(
    private readonly positionsRepository: PositionsRepository,
    private readonly priceService: PriceService,
  ) {}

  async getPositions(
    walletAddress: string,
    query: GetPositionsQueryDto,
  ): Promise<PositionsListResponse> {
    const normalized: PositionsQuery = {
      status: query.status ?? 'all',
      pool: query.pool?.trim() || undefined,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };

    const { items, total } =
      await this.positionsRepository.listPositionsByWallet(
        walletAddress,
        normalized,
      );

    const mapped = await Promise.all(
      items.map((position) => this.toResponse(position)),
    );

    return {
      items: mapped,
      page: normalized.page,
      limit: normalized.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / normalized.limit),
    };
  }

  private async toResponse(
    position: PositionSnapshot,
  ): Promise<PositionResponse> {
    const livePrice = await this.priceService.getSpotPrice(position.poolId);
    const currentPrice = livePrice
      ? Number.parseFloat(livePrice.currentPrice)
      : position.poolCurrentPrice;

    const rangeStatus =
      position.status === 'active'
        ? this.getRangeStatus(
            currentPrice,
            position.lowerTick,
            position.upperTick,
          )
        : null;

    return {
      id: position.id,
      poolId: position.poolId,
      tokenPair: {
        token0: position.token0,
        token1: position.token1,
      },
      lowerTick: position.lowerTick,
      upperTick: position.upperTick,
      liquidity: position.liquidity,
      currentValueUsd: position.currentValueUsd,
      uncollectedFeesToken0: position.uncollectedFeesToken0,
      uncollectedFeesToken1: position.uncollectedFeesToken1,
      createdAt: position.createdAt,
      closedAt: position.closedAt,
      status: position.status,
      rangeStatus,
    };
  }

  private getRangeStatus(
    currentPrice: number,
    lowerTick: number,
    upperTick: number,
  ): PositionRangeStatus {
    // `lowerTick`/`upperTick` are raw tick indices, while `currentPrice` is an
    // actual price (token1 per token0). Comparing them directly is invalid —
    // ticks must first be converted to price using price = 1.0001^tick, the
    // same formula used elsewhere in this codebase
    // (see packages/sdk/src/liquidity.ts and apps/api/src/pools/pools.service.ts).
    //
    // Boundary convention matches packages/sdk/src/position-math.ts:
    // price <= lowerPrice => below range, price >= upperPrice => above range,
    // so a position is only "in-range" on the open interval (lowerPrice, upperPrice).
    const lowerPrice = Math.pow(1.0001, lowerTick);
    const upperPrice = Math.pow(1.0001, upperTick);

    if (currentPrice > lowerPrice && currentPrice < upperPrice) {
      return 'in-range';
    }
    return 'out-of-range';
  }
}

export type { PositionsListResponse };
