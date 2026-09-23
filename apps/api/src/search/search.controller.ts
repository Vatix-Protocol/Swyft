import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SearchService, SearchResponse } from './search.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.SEARCH)
@ApiSecurity('api-key')
@Controller('search')
@UseGuards(ApiKeyGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search for tokens and pools by symbol, name, or address',
    description:
      'Pool results are ranked by 24h volume descending, then by pool id ascending so equal-volume ties stay stable across requests.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search query (min 2 characters)',
    example: 'USDC',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiResponse({
    status: 200,
    description:
      'Matching tokens and pools. Pools ordered by volume24h DESC, then poolId ASC.',
  })
  search(
    @Query('q') query = '',
    @Query('limit') limit = '10',
    @Query('offset') offset = '0',
  ): Promise<SearchResponse> {
    return this.searchService.search(query, Number(limit), Number(offset));
  }
}
