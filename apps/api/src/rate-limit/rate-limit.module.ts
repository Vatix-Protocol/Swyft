import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitMiddleware } from './rate-limit.middleware';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
      },
    ]),
  ],
  providers: [RateLimitMiddleware],
})
export class RateLimitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
