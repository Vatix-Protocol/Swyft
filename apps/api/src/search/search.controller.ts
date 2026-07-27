import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchService, SearchResponse } from './search.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.SEARCH)
@Controller('search')
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
  @ApiResponse({
    status: 200,
    description:
      'Matching tokens and pools. Pools ordered by volume24h DESC, then poolId ASC.',
  })
  search(@Query('q') query = ''): Promise<SearchResponse> {
    return this.searchService.search(query);
  }
}
