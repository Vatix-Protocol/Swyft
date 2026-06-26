import { ApiProperty } from '@nestjs/swagger';

export class PriceCandleDto {
  @ApiProperty({ description: 'Candle timestamp (unix seconds)' })
  time: number;

  @ApiProperty({ description: 'Opening price' })
  open: number;

  @ApiProperty({ description: 'Highest price' })
  high: number;

  @ApiProperty({ description: 'Lowest price' })
  low: number;

  @ApiProperty({ description: 'Closing price' })
  close: number;

  @ApiProperty({ description: 'Trading volume' })
  volume: number;
}
