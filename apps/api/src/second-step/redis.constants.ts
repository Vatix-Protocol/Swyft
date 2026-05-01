/**
 * Injection token used to provide the ioredis `Redis` instance
 * throughout the application.
 *
 * Usage:
 *   @Inject(REDIS_CLIENT) private readonly redis: Redis
 */
export const REDIS_CLIENT = 'REDIS_CLIENT' as const;
