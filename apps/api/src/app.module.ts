import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from './cache/cache.module';
import { PriceModule } from './price/price.module';
import { HorizonModule } from './horizon/horizon.module';
import { PoolsModule } from './pools/pools.module';
import { PositionsModule } from './positions/positions.module';
import { SwapsModule } from './swaps/swaps.module';
import { IndexerModule } from './indexer/indexer.module';
import { PrismaModule } from './prisma/prisma.module';
import { MetricsModule } from './metrics/metrics.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    CacheModule,
    PrismaModule,
    MetricsModule,
    PriceModule,
    PoolsModule,
    PositionsModule,
    SwapsModule,
    HorizonModule,
    IndexerModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
