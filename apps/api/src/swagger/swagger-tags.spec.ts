import 'reflect-metadata';

import { SWYFT_SWAGGER_TAGS } from './swagger-tags';
import { AnalyticsController } from '../admin/analytics.controller';
import { AuthController } from '../auth/auth.controller';
import { ApiKeysController } from '../api-keys/api-keys.controller';
import { BalancesController } from '../balances/balances.controller';
import { IndexerController } from '../indexer/indexer.controller';
import { MetricsController } from '../metrics/metrics.controller';
import { PoolsController } from '../pools/pools.controller';
import { PositionsController } from '../positions/positions.controller';
import { PriceController } from '../price/price.controller';
import { SearchController } from '../search/search.controller';
import { StatsController } from '../stats/stats.controller';
import { TvlAlertController } from '../stats/tvl-alert.controller';
import { SwapsController } from '../swaps/swaps.controller';
import { TransactionsController } from '../transactions/transactions.controller';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { TokensController } from '../tokens/tokens.controller';

/** Every controller class decorated with @ApiTags. */
const CONTROLLERS = [
  AnalyticsController,
  AuthController,
  ApiKeysController,
  BalancesController,
  IndexerController,
  MetricsController,
  PoolsController,
  PositionsController,
  PriceController,
  SearchController,
  StatsController,
  TvlAlertController,
  SwapsController,
  TransactionsController,
  WebhooksController,
  TokensController,
];

/**
 * Collect the @ApiTags values Nest stores on each controller class via
 * reflect-metadata.
 */
function collectUsedTags(): Set<string> {
  const used = new Set<string>();
  for (const controller of CONTROLLERS) {
    const tags = Reflect.getMetadata('swagger/apiUseTags', controller) as
      string[] | undefined;
    for (const tag of tags ?? []) {
      used.add(tag);
    }
  }
  return used;
}

describe('SWYFT_SWAGGER_TAGS', () => {
  it('covers every tag used by a controller', () => {
    const used = collectUsedTags();
    const declared = new Set(SWYFT_SWAGGER_TAGS);

    const undeclared = [...used].filter((tag) => !declared.has(tag));
    expect(undeclared).toEqual([]);
  });

  it('has no member that is unused by every controller', () => {
    const used = collectUsedTags();
    const declared = new Set(SWYFT_SWAGGER_TAGS);

    const unused = [...declared].filter((tag) => !used.has(tag));
    expect(unused).toEqual([]);
  });
});
