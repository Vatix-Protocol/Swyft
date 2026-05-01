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

export class GetPoolsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 20;

  @IsIn(['tvl', 'volume', 'apr'])
  @IsOptional()
  orderBy?: 'tvl' | 'volume' | 'apr' = 'tvl';

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsOptional()
  search?: string;
}
