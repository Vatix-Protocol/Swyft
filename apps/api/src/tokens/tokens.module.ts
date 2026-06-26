import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TokensController } from './tokens.controller';
import { TokenEnrichmentService } from './token-enrichment.service';

@Module({
  imports: [PrismaModule],
  controllers: [TokensController],
  providers: [TokenEnrichmentService],
  exports: [TokenEnrichmentService],
})
export class TokensModule {}
