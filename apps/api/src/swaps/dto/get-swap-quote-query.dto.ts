import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetSwapQuoteQueryDto {
  @ApiProperty({
    description: 'Address of the token being sold',
    example: 'CCUSDC...',
  })
  @IsString()
  @IsNotEmpty()
  tokenIn!: string;

  @ApiProperty({
    description: 'Address of the token being bought',
    example: 'CXLM...',
  })
  @IsString()
  @IsNotEmpty()
  tokenOut!: string;

  @ApiProperty({
    description: 'Exact input amount (tokenIn units, decimal string)',
    example: '100.0',
  })
  @IsString()
  @IsNotEmpty()
  amountIn!: string;

  @ApiPropertyOptional({
    description:
      'Slippage tolerance in basis points (0–10000). Defaults to 50 (0.5%).',
    minimum: 0,
    maximum: 10000,
    default: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  slippageBps?: number = 50;
}
