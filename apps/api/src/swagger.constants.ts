/** Typed API tag names for Swagger documentation */
export const SWAGGER_TAGS = {
  POOLS: 'pools',
  PRICES: 'prices',
  POSITIONS: 'positions',
  SEARCH: 'search',
  WEBHOOKS: 'webhooks',
  AUTH: 'auth',
} as const;

export type SwaggerTag = (typeof SWAGGER_TAGS)[keyof typeof SWAGGER_TAGS];
