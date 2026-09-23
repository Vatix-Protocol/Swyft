import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { SingleFlightService } from './single-flight.service';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';

@Global()
@Module({
  providers: [CacheService, SingleFlightService, RateLimitService, RateLimitGuard],
  exports: [CacheService, SingleFlightService, RateLimitService, RateLimitGuard],
})
export class CacheModule {}
