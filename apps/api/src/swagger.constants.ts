/** Typed API tag names for Swagger documentation */
/**
 * Swagger tag names used to group related API endpoints in generated docs.
 *
 * Each tag is exported as a constant for reuse across controller decorators.
 */
export const SWAGGER_TAGS = {
  /** Pool management, discovery, and liquidity-related endpoints. */
  POOLS: 'pools',

  /** Price lookup and market data endpoints. */
  PRICES: 'prices',

  /** Position lifecycle and ownership endpoints. */
  POSITIONS: 'positions',

  /** Search and discovery endpoints. */
  SEARCH: 'search',

  /** Webhook management and callback endpoints. */
  WEBHOOKS: 'webhooks',

  /** Authentication and authorization endpoints. */
  AUTH: 'auth',

  /** Indexer status and queue-health endpoints. */
  INDEXER: 'indexer',

  /** Internal analytics and monitoring endpoints. */
  ADMIN: 'admin',

  /** Transaction relay endpoints. */
  TRANSACTIONS: 'transactions',
} as const;

/** Valid Swagger tag values supported by the Swyft API. */
export type SwaggerTag = (typeof SWAGGER_TAGS)[keyof typeof SWAGGER_TAGS];
