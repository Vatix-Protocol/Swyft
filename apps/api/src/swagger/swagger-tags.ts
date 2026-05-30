export const SWYFT_SWAGGER_TAGS = [
  'pools',
  'positions',
  'prices',
  'search',
  'webhooks',
  'auth',
] as const;

export type SwyftSwaggerTag = (typeof SWYFT_SWAGGER_TAGS)[number];
