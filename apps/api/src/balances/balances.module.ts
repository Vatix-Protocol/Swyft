import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [BalancesController],
  providers: [BalancesService, ApiKeyGuard],
  exports: [BalancesService],
})
export class BalancesModule {}
