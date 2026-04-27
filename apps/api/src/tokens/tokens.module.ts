import { Module } from '@nestjs/common';
import { TokensController } from './tokens.controller';
import { TokenEnrichmentService } from './token-enrichment.service';

@Module({
  controllers: [TokensController],
  providers: [TokenEnrichmentService],
  exports: [TokenEnrichmentService],
})
export class TokensModule {}
