import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HorizonService } from './horizon.service';
import { PriceModule } from '../price/price.module';
import { PoolsModule } from '../pools/pools.module';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [ConfigModule, PriceModule, PoolsModule, IndexerModule],
  providers: [HorizonService],
})
export class HorizonModule {}
