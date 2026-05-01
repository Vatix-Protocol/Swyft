import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { RedisModule } from '../redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    // Makes ConfigService available for JWT options and anywhere in AuthService.
    ConfigModule,

    // Async registration so the secret is read from environment at boot time.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Default sign options; individual sign() calls may override expiresIn.
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '15m',
        },
      }),
    }),

    // Provides the REDIS_CLIENT injection token used in AuthService.
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  // Export AuthService so other modules (e.g. a Guards module) can reuse it.
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
