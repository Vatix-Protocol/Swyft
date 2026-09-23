import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min, MinLength } from 'class-validator';

const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

export class SwapQuoteRequestDto {
  @ApiProperty({
    description: 'Pool ID to quote the swap against',
    example: 'cltest123456789012345678',
  })
  @IsString({ message: 'poolId must be a string' })
  @MinLength(1, { message: 'poolId must not be empty' })
  poolId: string;

  @ApiProperty({
    description: 'Contract address of the token being sold',
    example: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  })
  @IsString({ message: 'tokenIn must be a string' })
  @MinLength(1, { message: 'tokenIn must not be empty' })
  tokenIn: string;

  @ApiProperty({
    description: 'Contract address of the token being bought',
    example: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  })
  @IsString({ message: 'tokenOut must be a string' })
  @MinLength(1, { message: 'tokenOut must not be empty' })
  tokenOut: string;

  @ApiProperty({
    description: 'Amount of tokenIn to swap, as a decimal string',
    example: '250.5',
  })
  @Matches(DECIMAL_AMOUNT_PATTERN, {
    message: 'amountIn must be a positive decimal string',
  })
  amountIn: string;

  @ApiProperty({
    description: 'Slippage tolerance in basis points (0-10000)',
    example: 50,
    minimum: 0,
    maximum: 10000,
  })
  @Type(() => Number)
  @IsInt({ message: 'slippageBps must be an integer number' })
  @Min(0, { message: 'slippageBps must be at least 0' })
  @Max(10000, { message: 'slippageBps must not be greater than 10000' })
  slippageBps: number;
}
