import { SearchController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchController', () => {
  const searchService = {
    search: jest.fn(),
  };

  beforeEach(() => {
    searchService.search.mockReset();
  });

  it('delegates to SearchService.search with the query param', async () => {
    const response = { tokens: [], pools: [] };
    searchService.search.mockResolvedValueOnce(response);
    const controller = new SearchController(
      searchService as unknown as SearchService,
    );

    await expect(controller.search('usdc')).resolves.toBe(response);
    expect(searchService.search).toHaveBeenCalledWith('usdc', 10, 0);
  });

  it('defaults the query to an empty string when none is provided', async () => {
    searchService.search.mockResolvedValueOnce({ tokens: [], pools: [] });
    const controller = new SearchController(
      searchService as unknown as SearchService,
    );

    await controller.search(undefined);
    expect(searchService.search).toHaveBeenCalledWith('', 10, 0);
  });

  it('passes pagination parameters as numbers', async () => {
    searchService.search.mockResolvedValueOnce({ tokens: [], pools: [] });
    const controller = new SearchController(
      searchService as unknown as SearchService,
    );

    await controller.search('usd', '25', '50');
    expect(searchService.search).toHaveBeenCalledWith('usd', 25, 50);
  });
});
