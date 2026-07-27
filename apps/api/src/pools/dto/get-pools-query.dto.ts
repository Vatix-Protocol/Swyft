import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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

  @ApiPropertyOptional({
    description:
      'When true, include inactive pools in the list. By default only active pools are returned.',
    default: false,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    return value;
  })
  @IsBoolean()
  includeInactive?: boolean;
}
