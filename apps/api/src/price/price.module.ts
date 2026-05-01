import { Module } from '@nestjs/common';
import { PriceController } from './price.controller';
import { PriceGateway } from './price.gateway';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';

@Module({
  controllers: [PriceController],
  providers: [PriceGateway, PriceService],
  exports: [PriceService],
})
export class PriceModule {}
