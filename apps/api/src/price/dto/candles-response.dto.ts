import { ApiProperty } from '@nestjs/swagger';
import { PriceCandleDto } from './price-candle.dto';

export class CandlesResponseDto {
  @ApiProperty({
    description: 'Pool ID for WebSocket subscription',
  })
  poolId: string;

  @ApiProperty({
    description: 'Array of candlestick data',
    type: [PriceCandleDto],
  })
  candles: PriceCandleDto[];
}
