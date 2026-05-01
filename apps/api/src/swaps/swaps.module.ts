import { Module } from '@nestjs/common';
import { SwapsController } from './swaps.controller';
import { SwapsRepository } from './swaps.repository';
import { SwapsService } from './swaps.service';

@Module({
  controllers: [SwapsController],
  providers: [SwapsRepository, SwapsService],
})
export class SwapsModule {}
