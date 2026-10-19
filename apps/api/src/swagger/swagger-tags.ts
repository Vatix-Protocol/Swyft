export const SWYFT_SWAGGER_TAGS = [
  'pools',
  'positions',
  'swaps',
  'prices',
  'search',
  'webhooks',
  'auth',
  'tokens',
  'stats',
  'balances',
  'indexer',
  'admin',
  'transactions',
] as const;

export type SwyftSwaggerTag = (typeof SWYFT_SWAGGER_TAGS)[number];
