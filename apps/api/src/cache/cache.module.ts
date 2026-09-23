import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { SingleFlightService } from './single-flight.service';

@Global()
@Module({
  providers: [CacheService, SingleFlightService],
  exports: [CacheService, SingleFlightService],
})
export class CacheModule {}
