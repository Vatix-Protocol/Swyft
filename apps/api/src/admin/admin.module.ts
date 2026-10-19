import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsScheduler } from './analytics.scheduler';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsScheduler,
    AdminAuditService,
    AdminAuditInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: AdminAuditInterceptor,
    },
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}
