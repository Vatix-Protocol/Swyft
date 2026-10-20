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
import {
  SLIPPAGE_BPS_DEFAULT,
  SLIPPAGE_BPS_MAX,
  SLIPPAGE_BPS_MIN,
} from '../swap.types';

export { SLIPPAGE_BPS_DEFAULT, SLIPPAGE_BPS_MAX, SLIPPAGE_BPS_MIN };

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
    description: `Slippage tolerance in basis points (1 bps = 0.01%), an integer from ${SLIPPAGE_BPS_MIN} to ${SLIPPAGE_BPS_MAX} inclusive. Defaults to ${SLIPPAGE_BPS_DEFAULT} (0.5%).`,
    minimum: SLIPPAGE_BPS_MIN,
    maximum: SLIPPAGE_BPS_MAX,
    default: SLIPPAGE_BPS_DEFAULT,
  })
  @Type(() => Number)
  @IsInt({ message: 'slippageBps must be an integer number' })
  @Min(SLIPPAGE_BPS_MIN, {
    message: `slippageBps must be at least ${SLIPPAGE_BPS_MIN}`,
  })
  @Max(SLIPPAGE_BPS_MAX, {
    message: `slippageBps must not be greater than ${SLIPPAGE_BPS_MAX}`,
  })
  @IsOptional()
  slippageBps?: number = SLIPPAGE_BPS_DEFAULT;
}
