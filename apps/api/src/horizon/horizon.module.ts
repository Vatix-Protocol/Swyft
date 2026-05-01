import { Module } from '@nestjs/common';
import { HorizonService } from './horizon.service';
import { PriceModule } from '../price/price.module';
import { PoolsModule } from '../pools/pools.module';

@Module({
  imports: [PriceModule, PoolsModule],
  providers: [HorizonService],
})
export class HorizonModule {}
