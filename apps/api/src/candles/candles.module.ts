import { Module } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { CandlesWorker } from './candles.processor';
import { TwapService } from './twap.service';
import { TwapController } from './twap.controller';

@Module({
  controllers: [TwapController],
  providers: [CandlesService, CandlesWorker, TwapService],
  exports: [TwapService],
})
export class CandlesModule {}
