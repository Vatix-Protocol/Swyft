import { Module } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { CandlesProcessor } from './candles.processor';

@Module({
  providers: [CandlesService, CandlesProcessor],
  exports: [CandlesService, CandlesProcessor],
})
export class CandlesModule {}
