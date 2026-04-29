import { Module } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { CandlesWorker } from './candles.processor';

@Module({
  providers: [CandlesService, CandlesWorker],
})
export class CandlesModule {}
