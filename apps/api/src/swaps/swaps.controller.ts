import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetSwapsQueryDto } from './dto/get-swaps-query.dto';
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
}
