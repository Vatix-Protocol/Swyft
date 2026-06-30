import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetPoolsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Sort pools by this field',
    enum: ['tvl', 'volume', 'apr'],
    default: 'tvl',
  })
  @IsIn(['tvl', 'volume', 'apr'])
  @IsOptional()
  orderBy?: 'tvl' | 'volume' | 'apr' = 'tvl';

  @ApiPropertyOptional({
    description: 'Filter pools by token symbol or address',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter pools where this address is token0 or token1',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsOptional()
  token0?: string;

  @ApiPropertyOptional({
    description: 'Filter pools where this address is token0 or token1',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsOptional()
  token1?: string;
}
