import { ApiProperty } from '@nestjs/swagger';

export class SwapQuoteResponseDto {
  @ApiProperty({
    description: 'Estimated amount of tokenOut received, before slippage',
    example: '249.755925',
  })
  amountOut: string;

  @ApiProperty({
    description:
      'Estimated price impact in percent. This is a spot-price estimate ' +
      '(no tick-crossing depth simulation), so it is always 0 for now.',
    example: 0,
  })
  priceImpact: number;

  @ApiProperty({
    description: 'LP fee charged, denominated in tokenIn',
    example: '0.7515',
  })
  lpFee: string;

  @ApiProperty({
    description: 'Minimum amount of tokenOut received after slippage tolerance',
    example: '248.507644',
  })
  minimumReceived: string;

  @ApiProperty({
    description: 'Effective execution price (tokenOut per tokenIn)',
    example: '0.996830',
  })
  executionPrice: string;
}
