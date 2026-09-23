import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Pagination for `GET /tokens`.
 *
 * `limit` beyond the maximum is rejected with a 400 (via the global
 * ValidationPipe) rather than silently clamped — the same choice already
 * made by GetPoolsQueryDto, GetPositionsQueryDto, and GetSwapsQueryDto, so
 * oversized page sizes fail loudly and consistently across list endpoints.
 */
export class GetTokensQueryDto {
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
    maximum: 100,
    default: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 50;
}
