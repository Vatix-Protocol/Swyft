import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { TokensController } from './tokens.controller';
import { TokenEnrichmentService } from './token-enrichment.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [TokensController],
  providers: [TokenEnrichmentService, ApiKeyGuard],
  exports: [TokenEnrichmentService],
})
export class TokensModule {}
