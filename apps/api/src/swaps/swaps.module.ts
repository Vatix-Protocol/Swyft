import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PoolsModule } from '../pools/pools.module';
import { SwapsController } from './swaps.controller';
import { SwapsRepository } from './swaps.repository';
import { SwapsService } from './swaps.service';

@Module({
  imports: [PrismaModule, PoolsModule],
  controllers: [SwapsController],
  providers: [SwapsRepository, SwapsService],
})
export class SwapsModule {}
