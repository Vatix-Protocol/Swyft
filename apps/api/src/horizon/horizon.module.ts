import { Module } from '@nestjs/common';
import { HorizonService } from './horizon.service';
import { PriceModule } from '../price/price.module';
import { PoolsModule } from '../pools/pools.module';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [PriceModule, PoolsModule, IndexerModule],
  providers: [HorizonService],
})
export class HorizonModule {}
