import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { TicksModule } from './ticks/ticks.module';
import { FeeCollectorModule } from './fee-collector/fee-collector.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BalancesModule } from './balances/balances.module';
import { WebsocketModule } from './websocket/websocket.module';
import { stellarConfig, resolveStellarConfig, stellarConfigSummary } from './config/stellar.config';
import { infraConfig } from './config/infra.config';
import { resolveCorsConfig } from './config/cors.config';
import { resolveRateLimitConfig, RateLimitConfig } from './config/rate-limit.config';
import { applySentryRedactionPolicy } from './observability/sentry-redaction';

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
    TicksModule,
    // Fee collector: fee accumulation + FEE_COLLECTOR_AUTH (issue #965).
    // Registered after AuthModule so the deny-by-default guard can resolve
    // the auth service; writes fail closed when dependencies are unavailable.
    FeeCollectorModule,
    TransactionsModule,
    BalancesModule,
    // WebSocket reconnect (issue #991): typed reconnect entrypoints with
    // stable error codes, correlation ids, deny-by-default authz on
    // privileged channels, and idempotent resubscription. Registered after
    // AuthModule so the reconnect guard can resolve the auth service and
    // fail closed when dependencies are unavailable.
    WebsocketModule,
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly config: ConfigService) {
    // Apply the SENTRY_REDACTION_POLICY (issue #987) at bootstrap so every
    // Sentry event/transaction/breadcrumb is scrubbed before it leaves the
    // process. Deny-by-default: unknown fields are dropped, and the policy is
    // server-controlled — untrusted clients cannot opt out or widen it.
    applySentryRedactionPolicy(this.config);

    // Validate the Stellar network selection at bootstrap (issue #988).
    // Fail-closed: an unset/invalid STELLAR_NETWORK, a mainnet selection
    // without the STELLAR_MAINNET_ENABLED kill-switch, or a passphrase that
    // does not match the selected network aborts startup rather than running
    // against the wrong chain. Only an ops-safe summary is logged.
    const stellar = resolveStellarConfig(process.env);
    // eslint-disable-next-line no-console
    console.log('[stellar-config] resolved', stellarConfigSummary(stellar));
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }

  static corsOptions(config: ConfigService) {
    const { origins, credentials } = resolveCorsConfig({
      ...process.env,
      CORS_ALLOWED_ORIGINS:
        config.get<string>('CORS_ALLOWED_ORIGINS') ?? process.env.CORS_ALLOWED_ORIGINS,
      CORS_ALLOW_CREDENTIALS:
        config.get<string>('CORS_ALLOW_CREDENTIALS') ?? process.env.CORS_ALLOW_CREDENTIALS,
    });

    return {
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Same-origin / non-browser requests have no Origin header.
        if (!origin) {
          return callback(null, true);
        }
        if (origins.includes(origin)) {
          return callback(null, true);
        }
        // Fail closed: reject unlisted origins instead of reflecting them.
        return callback(null, false);
      },
      credentials,
    };
  }

  static rateLimitOptions(config: ConfigService): RateLimitConfig {
    return resolveRateLimitConfig({
      ...process.env,
      RATE_LIMIT_ENABLED:
        config.get<string>('RATE_LIMIT_ENABLED') ?? process.env.RATE_LIMIT_ENABLED,
      RATE_LIMIT_WINDOW_MS:
        config.get<string>('RATE_LIMIT_WINDOW_MS') ?? process.env.RATE_LIMIT_WINDOW_MS,
      RATE_LIMIT_MAX:
        config.get<string>('RATE_LIMIT_MAX') ?? process.env.RATE_LIMIT_MAX,
      RATE_LIMIT_FAIL_CLOSED:
        config.get<string>('RATE_LIMIT_FAIL_CLOSED') ?? process.env.RATE_LIMIT_FAIL_CLOSED,
    });
  }
}
