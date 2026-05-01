import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetPositionsQueryDto {
  @IsIn(['active', 'closed', 'all'])
  @IsOptional()
  status?: 'active' | 'closed' | 'all' = 'all';

  @IsString()
  @IsOptional()
  pool?: string;

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
}
