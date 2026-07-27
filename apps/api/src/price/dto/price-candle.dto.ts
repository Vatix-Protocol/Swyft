import { ApiProperty } from '@nestjs/swagger';

export class PriceCandleDto {
  @ApiProperty({ description: 'Candle timestamp (unix seconds)' })
  time: number;

  @ApiProperty({
    description:
      'Opening price, or null when this interval is a gap (no trades)',
    nullable: true,
  })
  open: number | null;

  @ApiProperty({
    description:
      'Highest price, or null when this interval is a gap (no trades)',
    nullable: true,
  })
  high: number | null;

  @ApiProperty({
    description:
      'Lowest price, or null when this interval is a gap (no trades)',
    nullable: true,
  })
  low: number | null;

  @ApiProperty({
    description:
      'Closing price, or null when this interval is a gap (no trades)',
    nullable: true,
  })
  close: number | null;

  @ApiProperty({
    description:
      'Trading volume, or null when this interval is a gap (no trades)',
    nullable: true,
  })
  volume: number | null;
}
