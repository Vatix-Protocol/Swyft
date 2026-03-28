import { ApiProperty } from '@nestjs/swagger';

export class PriceCandleDto {
  @ApiProperty({ description: 'Candle timestamp' })
  timestamp: number;

  @ApiProperty({ description: 'Opening price' })
  open: string;

  @ApiProperty({ description: 'Highest price' })
  high: string;

  @ApiProperty({ description: 'Lowest price' })
  low: string;

  @ApiProperty({ description: 'Closing price' })
  close: string;

  @ApiProperty({ description: 'Trading volume' })
  volume: string;
}
