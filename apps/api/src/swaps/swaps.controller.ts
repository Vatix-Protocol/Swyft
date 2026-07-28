import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SWAGGER_TAGS } from '../swagger.constants';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { SwapQuoteRequestDto } from './dto/swap-quote-request.dto';
import { SwapQuoteResponseDto } from './dto/swap-quote-response.dto';
import { SwapsListResponse, SwapsService } from './swaps.service';

@ApiTags(SWAGGER_TAGS.SWAPS)
@Controller('swaps')
export class SwapsController {
  constructor(private readonly swapsService: SwapsService) {}

  @Get()
  @ApiOperation({
    summary: 'List swaps with optional filtering by pool and wallet',
    description:
      'Returns a paginated list of swaps. Filter by poolId to get all swaps for a specific pool. Filter by wallet to get swaps for a specific address.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated swap list. Each item includes a normalized tokenPair field (e.g. "USDC/XLM").',
  })
  getSwaps(@Query() query: GetSwapsQueryDto): Promise<SwapsListResponse> {
    return this.swapsService.getSwaps(query);
  }

  @Post('quote')
  @ApiOperation({
    summary: 'Get a swap quote estimate for a pool',
    description:
      "Returns an estimated output amount, fee, and minimum received for a given input amount, based on the pool's current spot price. This is a spot-price estimate, not a full tick-crossing simulation, so priceImpact is always 0.",
  })
  @ApiBody({
    type: SwapQuoteRequestDto,
    examples: {
      default: {
        summary: 'Swap 250.5 USDC for WETH with a 0.5% slippage tolerance',
        value: {
          poolId: 'cltest123456789012345678',
          tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amountIn: '250.5',
          slippageBps: 50,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Swap quote estimate',
    type: SwapQuoteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Pool not found' })
  @ApiResponse({
    status: 400,
    description: "tokenIn/tokenOut do not match the pool's tokens",
  })
  @ApiResponse({ status: 422, description: 'Pool has no valid price yet' })
  getQuote(@Body() dto: SwapQuoteRequestDto): Promise<SwapQuoteResponseDto> {
    return this.swapsService.getQuote(dto);
  }
}
