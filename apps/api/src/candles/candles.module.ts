import { Module } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { CandlesWorker } from './candles.processor';
import { CandleGapPolicy } from './candle-gap.policy';

@Module({
  providers: [CandleGapPolicy, CandlesService, CandlesWorker],
  exports: [CandleGapPolicy, CandlesService],
})
export class CandlesModule {}
