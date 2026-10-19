import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PoolsController } from './pools.controller';
import { PoolsRepository } from './pools.repository';
import { PoolsService } from './pools.service';

@Module({
  imports: [CacheModule, PrismaModule, AuthModule],
  controllers: [PoolsController],
  providers: [PoolsRepository, PoolsService],
  exports: [PoolsService],
})
export class PoolsModule {}
