import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from './cache/cache.module';
import { PriceModule } from './price/price.module';
import { HorizonModule } from './horizon/horizon.module';
import { PoolsModule } from './pools/pools.module';

@Module({
  imports: [CacheModule, PriceModule, HorizonModule, PoolsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
