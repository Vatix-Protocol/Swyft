import { Module } from '@nestjs/common';
import { HorizonService } from './horizon.service';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [PriceModule],
  providers: [HorizonService],
})
export class HorizonModule {}
