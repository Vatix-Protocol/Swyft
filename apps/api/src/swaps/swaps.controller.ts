import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SWAGGER_TAGS } from '../swagger.constants';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { SwapQuoteRequestDto } from './dto/swap-quote-request.dto';
import { SwapQuoteResponseDto } from './dto/swap-quote-response.dto';
import { SwapsListResponse, SwapsService } from './swaps.service';

@ApiTags(SWAGGER_TAGS.SWAPS)
@ApiSecurity('api-key')
@Controller('swaps')
@UseGuards(ApiKeyGuard)
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
        summary: 'Swap 250.5 USDC for XLM with a 0.5% slippage tolerance',
        value: {
          poolId: 'cltest123456789012345678',
          tokenIn: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
          tokenOut: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
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
