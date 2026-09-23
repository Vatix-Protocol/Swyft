import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Absolute tick index bounds for concentrated-liquidity pools.
 *
 * These mirror the on-chain `MIN_TICK` / `MAX_TICK` constants and are the
 * outermost envelope a pool's `[minTick, maxTick]` range may occupy. Per-pool
 * `tickSpacing` alignment and the pool's own range are enforced server-side in
 * the pools service (source of truth); this DTO rejects obviously out-of-range
 * input at the edge so untrusted clients cannot bypass policy.
 */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export class GetTicksQueryDto {
  @ApiPropertyOptional({
    description: 'Lower bound tick index (inclusive)',
    minimum: MIN_TICK,
    maximum: MAX_TICK,
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_TICK)
  @Max(MAX_TICK)
  @IsOptional()
  lowerTick?: number;

  @ApiPropertyOptional({
    description: 'Upper bound tick index (inclusive)',
    minimum: MIN_TICK,
    maximum: MAX_TICK,
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_TICK)
  @Max(MAX_TICK)
  @IsOptional()
  upperTick?: number;
}
