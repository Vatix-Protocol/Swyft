import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from './cache/cache.module';
import { PriceModule } from './price/price.module';
import { HorizonModule } from './horizon/horizon.module';
import { IndexerModule } from './indexer/indexer.module';
import { PoolsModule } from './pools/pools.module';
import { PositionsModule } from './positions/positions.module';

@Module({
  imports: [CacheModule, PriceModule, HorizonModule, IndexerModule, PoolsModule, PositionsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
