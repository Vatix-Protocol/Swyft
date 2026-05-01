import { Module } from '@nestjs/common';
import { PriceModule } from '../price/price.module';
import { PositionsController } from './positions.controller';
import { PositionsRepository } from './positions.repository';
import { PositionsService } from './positions.service';

@Module({
  imports: [PriceModule],
  controllers: [PositionsController],
  providers: [PositionsRepository, PositionsService],
})
export class PositionsModule {}
