import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
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
import { LoggingMiddleware } from './logging/logging.middleware';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CandlesModule } from './candles/candles.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { StatsModule } from './stats/stats.module';
import { TokensModule } from './tokens/tokens.module';
import { SearchModule } from './search/search.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BalancesModule } from './balances/balances.module';
import { stellarConfig } from './config/stellar.config';
import { infraConfig } from './config/infra.config';

@Module({
  imports: [
    // Global config — validates env vars at startup and exposes typed config
    // namespaces throughout the application via ConfigService injection.
    ConfigModule.forRoot({
      isGlobal: true,
      load: [stellarConfig, infraConfig],
      // Do not throw on extra keys; only the declared vars are validated.
      ignoreEnvVars: false,
    }),
    // Registered once here so any module can inject @Cron/@Interval/@Timeout
    // schedulers without re-registering the global scheduler (which throws
    // if bound more than once in the same Nest application graph).
    ScheduleModule.forRoot(),
    CacheModule,
    PrismaModule,
    MetricsModule,
    RateLimitModule,
    AuthModule,
    PriceModule,
    PoolsModule,
    PositionsModule,
    SwapsModule,
    HorizonModule,
    IndexerModule,
    AdminModule,
    ApiKeysModule,
    WebhooksModule,
    CandlesModule,
    StatsModule,
    SearchModule,
    TokensModule,
    TransactionsModule,
    BalancesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
