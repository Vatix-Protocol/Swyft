import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchService, SearchResponse } from './search.service';
import { SWAGGER_TAGS } from '../swagger.constants';

@ApiTags(SWAGGER_TAGS.SEARCH)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Search for tokens and pools by symbol, name, or address' })
  @ApiQuery({ name: 'q', required: false, description: 'Search query (min 2 characters)', example: 'USDC' })
  @ApiResponse({ status: 200, description: 'Matching tokens and pools' })
  search(@Query('q') query = ''): Promise<SearchResponse> {
    return this.searchService.search(query);
  }
}
