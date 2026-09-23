import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsScheduler } from './analytics.scheduler';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { TestnetRegistryController } from './testnet-registry.controller';
import { TestnetRegistryService } from './testnet-registry.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController, TestnetRegistryController],
  providers: [
    AnalyticsService,
    AnalyticsScheduler,
    AdminAuditService,
    AdminAuditInterceptor,
    TestnetRegistryService,
    {
      provide: APP_INTERCEPTOR,
      useExisting: AdminAuditInterceptor,
    },
  ],
  exports: [AdminAuditService, TestnetRegistryService],
})
export class AdminModule {}
