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
  @IsOptional()
  @IsString({ message: 'pool must be a string' })
  @MinLength(1, { message: 'pool must not be empty' })
  pool?: string;

  @IsOptional()
  @IsString({ message: 'wallet must be a string' })
  @Matches(ADDRESS_PATTERN, {
    message: 'wallet must be a valid wallet address',
  })
  wallet?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'page must be an integer number' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'limit must be an integer number' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not be greater than 100' })
  limit?: number = 20;
}
