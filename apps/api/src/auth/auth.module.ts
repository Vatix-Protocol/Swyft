import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { RedisModule } from '../redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { NonceController } from './nonce.controller';

/** Placeholder value shipped in apps/api/.env.example — never valid in production. */
const INSECURE_DEFAULT_JWT_SECRET = 'change-me-in-production';

/**
 * Reads JWT_SECRET from config, refusing to boot in production if it is
 * missing or still set to the insecure placeholder from .env.example.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.getOrThrow<string>('JWT_SECRET');
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && secret === INSECURE_DEFAULT_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is set to the insecure default "change-me-in-production". ' +
        'Set a unique secret before starting the API in production.',
    );
  }

  return secret;
}

@Module({
  imports: [
    // Makes ConfigService available for JWT options and anywhere in AuthService.
    ConfigModule,

    // Async registration so the secret is read from environment at boot time.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        // Default sign options; individual sign() calls may override expiresIn.
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '15m') as `${number}m`,
        },
      }),
    }),

    // Provides the REDIS_CLIENT injection token used in AuthService.
    RedisModule,
  ],
  controllers: [AuthController, NonceController],
  providers: [AuthService],
  // Export AuthService so other modules (e.g. a Guards module) can reuse it.
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
