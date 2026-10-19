import { ApiProperty } from '@nestjs/swagger';

export class TokenDto {
  @ApiProperty({ description: 'Token contract address' })
  address: string;

  @ApiProperty({ description: 'Token symbol' })
  symbol: string;

  @ApiProperty({ description: 'Token name' })
  name: string;

  @ApiProperty({ description: 'Token decimals' })
  decimals: number;
}

export class SwapDto {
  @ApiProperty({ description: 'Swap transaction ID' })
  id: string;

  @ApiProperty({ description: 'Swap timestamp' })
  timestamp: number;

  @ApiProperty({ description: 'Token0 amount swapped' })
  token0Amount: string;

  @ApiProperty({ description: 'Token1 amount swapped' })
  token1Amount: string;

  @ApiProperty({ description: 'Swap price' })
  price: string;

  @ApiProperty({ description: 'Swap type', enum: ['buy', 'sell'] })
  type: 'buy' | 'sell';

  @ApiProperty({ description: 'Transaction hash' })
  txHash: string;
}

/**
 * Concentrated-liquidity view of the pool. Derived from the pool record (the
 * single source of truth), never from an independent cl-pool store.
 */
export class ClPoolViewDto {
  @ApiProperty({
    description:
      'Authoritative record this view was derived from. Always "pool".',
    enum: ['pool'],
    example: 'pool',
  })
  source: 'pool';

  @ApiProperty({
    description:
      'Always true: this is a derived view, not an independent authority.',
    enum: [true],
    example: true,
  })
  derived: true;

  @ApiProperty({ description: 'ID of the pool record this was derived from' })
  poolId: string;

  @ApiProperty({
    description: 'Epoch milliseconds at which the view was derived',
    example: 1767225600000,
  })
  derivedAt: number;

  @ApiProperty({
    description: 'Current sqrt price (Q64.96) as a decimal string',
    example: '79228162514264337593543950336',
  })
  sqrtPriceX96: string;

  @ApiProperty({ description: 'Current tick index', example: 0 })
  tick: number;

  @ApiProperty({
    description: 'Active liquidity as a decimal string',
    example: '1000000000000000000',
  })
  liquidity: string;

  @ApiProperty({
    description: "Tick spacing implied by the pool's fee tier",
    example: 60,
  })
  tickSpacing: number;
}

export class PoolDetailDto {
  @ApiProperty({ description: 'Pool ID' })
  id: string;

  @ApiProperty({ type: TokenDto })
  token0: TokenDto;

  @ApiProperty({ type: TokenDto })
  token1: TokenDto;

  @ApiProperty({ description: 'Fee tier in basis points' })
  feeTier: number;

  @ApiProperty({ description: 'Current square root price' })
  currentSqrtPrice: string;

  @ApiProperty({ description: 'Current tick' })
  currentTick: number;

  @ApiProperty({ description: 'Total liquidity' })
  totalLiquidity: string;

  @ApiProperty({ description: 'Total value locked' })
  tvl: string;

  @ApiProperty({ description: '24 hour volume' })
  volume24h: string;

  @ApiProperty({ description: '7 day volume' })
  volume7d: string;

  @ApiProperty({ description: 'Fee APR' })
  feeApr: string;

  @ApiProperty({ description: 'Pool creation timestamp' })
  creationTimestamp: number;

  @ApiProperty({ type: [SwapDto], description: 'Recent swaps' })
  recentSwaps: SwapDto[];

  @ApiProperty({
    type: ClPoolViewDto,
    description:
      'Concentrated-liquidity state derived from this pool record, with provenance (source, derived, poolId, derivedAt)',
  })
  clPool: ClPoolViewDto;
}
