import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PriceController } from './price.controller';
import { PriceGateway } from './price.gateway';
import { PriceService } from './price.service';

@Module({
  imports: [AuthModule],
  controllers: [PriceController],
  providers: [PriceGateway, PriceService],
  exports: [PriceService],
})
export class PriceModule {}
