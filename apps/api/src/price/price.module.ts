import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { PriceController } from './price.controller';
import { PriceGateway } from './price.gateway';
import { PriceService } from './price.service';

@Module({
  controllers: [PriceController],
  providers: [PriceGateway, PriceService, ApiKeyGuard],
  exports: [PriceService],
})
export class PriceModule {}
