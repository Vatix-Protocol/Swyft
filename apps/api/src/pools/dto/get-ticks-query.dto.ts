import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetTicksQueryDto {
  @ApiPropertyOptional({ description: 'Lower bound tick index (inclusive)' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  lowerTick?: number;

  @ApiPropertyOptional({ description: 'Upper bound tick index (inclusive)' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  upperTick?: number;
}
