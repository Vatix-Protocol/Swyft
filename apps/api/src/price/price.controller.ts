import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PriceService } from './price.service';
import { CacheService, TTL } from '../cache/cache.service';
import { PriceCandleDto } from './dto/price-candle.dto';

export interface PriceCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

@ApiTags('prices')
@Controller('prices')
export class PriceController {
  constructor(
    private readonly priceService: PriceService,
    private readonly cacheService: CacheService,
  ) {}

  @Get(':tokenA/:tokenB/candles')
  @ApiOperation({ summary: 'Get OHLCV candlestick data for a token pair' })
  @ApiParam({ name: 'tokenA', description: 'First token address or symbol' })
  @ApiParam({ name: 'tokenB', description: 'Second token address or symbol' })
  @ApiQuery({ name: 'interval', enum: ['1m', '5m', '1h', '1d'], required: false, description: 'Candle interval' })
  @ApiQuery({ name: 'from', required: false, description: 'Start timestamp (unix)' })
  @ApiQuery({ name: 'to', required: false, description: 'End timestamp (unix)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of candles (max 500)' })
  @ApiResponse({ status: 200, type: [PriceCandleDto], description: 'Candlestick data retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 404, description: 'No price data found for token pair' })
  async getCandles(
    @Param('tokenA') tokenA: string,
    @Param('tokenB') tokenB: string,
    @Query('interval') interval: string = '1h',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    // Validate interval
    const validIntervals = ['1m', '5m', '1h', '1d'];
    if (!validIntervals.includes(interval)) {
      throw new BadRequestException(`Invalid interval. Must be one of: ${validIntervals.join(', ')}`);
    }

    // Parse and validate limit
    const parsedLimit = limit ? parseInt(limit, 10) : 168;
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
      throw new BadRequestException('Limit must be a number between 1 and 500');
    }

    // Parse timestamps
    const now = Date.now();
    const parsedTo = to ? parseInt(to, 10) : Math.floor(now / 1000);
    const parsedFrom = from ? parseInt(from, 10) : parsedTo - this.getDefaultIntervalSeconds(interval) * parsedLimit;

    if (isNaN(parsedFrom) || isNaN(parsedTo)) {
      throw new BadRequestException('From and to must be valid unix timestamps');
    }

    if (parsedFrom >= parsedTo) {
      throw new BadRequestException('From timestamp must be before to timestamp');
    }

    // Generate cache key
    const cacheKey = `candles:${tokenA}:${tokenB}:${interval}:${parsedFrom}:${parsedTo}:${parsedLimit}`;
    
    // Try cache first
    const cached = await this.cacheService.get<PriceCandle[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get candles from service
    const candles = await this.priceService.getCandles(
      tokenA,
      tokenB,
      interval,
      parsedFrom,
      parsedTo,
      parsedLimit,
    );

    if (candles.length === 0) {
      throw new NotFoundException(`No price data found for token pair ${tokenA}/${tokenB}`);
    }

    // Cache with appropriate TTL
    const ttl = interval === '1m' || interval === '5m' ? TTL.CANDLES_FAST : TTL.CANDLES_SLOW;
    await this.cacheService.set(cacheKey, candles, ttl);

    return candles;
  }

  private getDefaultIntervalSeconds(interval: string): number {
    switch (interval) {
      case '1m': return 60;
      case '5m': return 300;
      case '1h': return 3600;
      case '1d': return 86400;
      default: return 3600;
    }
  }
}
