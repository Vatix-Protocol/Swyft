import { Controller, Get, Query } from '@nestjs/common';
import { SearchService, SearchResponse } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query('q') query = ''): Promise<SearchResponse> {
    return this.searchService.search(query);
  }
}
