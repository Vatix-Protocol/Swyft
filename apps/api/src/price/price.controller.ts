import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PriceService, SpotPriceResponse } from './price.service';
import { CacheService, TTL } from '../cache/cache.service';
import { PriceCandleDto } from './dto/price-candle.dto';
import { CandlesResponseDto } from './dto/candles-response.dto';
import { SWAGGER_TAGS } from '../swagger.constants';

const VALID_INTERVALS = ['1m', '5m', '1h', '1d'] as const;
type CandleInterval = (typeof VALID_INTERVALS)[number];

@ApiTags(SWAGGER_TAGS.PRICES)
@Controller('prices')
export class PriceController {
  constructor(
    private readonly priceService: PriceService,
    private readonly cacheService: CacheService,
  ) {}

  @Get(':tokenA/:tokenB')
  @ApiOperation({ summary: 'Get the current spot price for a token pair' })
  @ApiParam({ name: 'tokenA', description: 'First token address or symbol' })
  @ApiParam({ name: 'tokenB', description: 'Second token address or symbol' })
  @ApiResponse({
    status: 200,
    description: 'Spot price retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'No price data found for token pair',
  })
  getPrice(
    @Param('tokenA') tokenA: string,
    @Param('tokenB') tokenB: string,
  ): Promise<SpotPriceResponse> {
    return this.priceService.getTokenPairPrice(tokenA, tokenB);
  }

  @Get(':tokenA/:tokenB/candles')
  @ApiOperation({ summary: 'Get OHLCV candlestick data for a token pair' })
  @ApiParam({ name: 'tokenA', description: 'First token address or symbol' })
  @ApiParam({ name: 'tokenB', description: 'Second token address or symbol' })
  @ApiQuery({
    name: 'interval',
    enum: VALID_INTERVALS,
    required: false,
    description: 'Candle interval',
    example: '1h',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: Number,
    description: 'Start timestamp (unix seconds)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: Number,
    description: 'End timestamp (unix seconds)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of candles (max 500)',
    example: 168,
  })
  @ApiResponse({
    status: 200,
    type: CandlesResponseDto,
    description: 'Candlestick data retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({
    status: 404,
    description: 'No price data found for token pair',
  })
  async getCandles(
    @Param('tokenA') tokenA: string,
    @Param('tokenB') tokenB: string,
    @Query('interval') interval: CandleInterval = '1h',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<CandlesResponseDto> {
    if (!VALID_INTERVALS.includes(interval)) {
      throw new BadRequestException(
        `Invalid interval. Must be one of: ${VALID_INTERVALS.join(', ')}`,
      );
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 168;
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
      throw new BadRequestException('Limit must be a number between 1 and 500');
    }

    const now = Date.now();
    const parsedTo = to ? parseInt(to, 10) : Math.floor(now / 1000);
    const parsedFrom = from
      ? parseInt(from, 10)
      : parsedTo - this.getDefaultIntervalSeconds(interval) * parsedLimit;

    if (isNaN(parsedFrom) || isNaN(parsedTo)) {
      throw new BadRequestException(
        'from and to must be valid unix timestamps',
      );
    }

    if (parsedFrom >= parsedTo) {
      throw new BadRequestException(
        'from timestamp must be before to timestamp',
      );
    }

    const cacheKey = `candles:${tokenA}:${tokenB}:${interval}:${parsedFrom}:${parsedTo}:${parsedLimit}`;

    const cached = await this.cacheService.get<CandlesResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const { poolId, candles } = await this.priceService.getCandles(
      tokenA,
      tokenB,
      interval,
      parsedFrom,
      parsedTo,
      parsedLimit,
    );

    if (candles.length === 0) {
      throw new NotFoundException(
        `No price data found for token pair ${tokenA}/${tokenB}`,
      );
    }

    const ttl =
      interval === '1m' || interval === '5m'
        ? TTL.CANDLES_FAST
        : TTL.CANDLES_SLOW;
    const response: CandlesResponseDto = { poolId, candles };
    await this.cacheService.set(cacheKey, response, ttl);

    return response;
  }

  private getDefaultIntervalSeconds(interval: CandleInterval): number {
    const map: Record<CandleInterval, number> = {
      '1m': 60,
      '5m': 300,
      '1h': 3600,
      '1d': 86400,
    };
    return map[interval];
  }
}
