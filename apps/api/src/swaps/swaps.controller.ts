import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
import { GetSwapQuoteQueryDto } from './dto/get-swap-quote-query.dto';
import { SwapQuoteResult } from './swap.types';
import { SwapsListResponse, SwapsService } from './swaps.service';

@ApiTags('Swaps')
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

  @Get('quote')
  @ApiOperation({
    summary: 'Get a swap quote for a token pair',
    description:
      'Validates that both tokenIn and tokenOut exist in the token registry before quoting. Unknown addresses return HTTP 400 with code UNKNOWN_TOKEN.',
  })
  @ApiResponse({
    status: 200,
    description: 'Quote for the requested token pair.',
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown token address. Response includes code UNKNOWN_TOKEN.',
  })
  getQuote(@Query() query: GetSwapQuoteQueryDto): Promise<SwapQuoteResult> {
    return this.swapsService.getQuote(query);
  }
}
