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
}
