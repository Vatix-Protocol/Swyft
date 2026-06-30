import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

export class GetSwapsQueryDto {
  @ApiPropertyOptional({ description: 'Filter swaps by pool ID' })
  @IsOptional()
  @IsString({ message: 'poolId must be a string' })
  @MinLength(1, { message: 'poolId must not be empty' })
  poolId?: string;

  @ApiPropertyOptional({
    description: 'Filter swaps by wallet address (sender or recipient)',
    pattern: '^G[A-Z2-7]{55}$',
  })
  @IsOptional()
  @IsString({ message: 'wallet must be a string' })
  @Matches(ADDRESS_PATTERN, {
    message: 'wallet must be a valid wallet address',
  })
  wallet?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'page must be an integer number' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'limit must be an integer number' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not be greater than 100' })
  limit?: number = 20;
}
