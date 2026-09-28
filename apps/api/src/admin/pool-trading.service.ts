import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PoolTradingState {
  poolId: string;
  paused: boolean;
  active: boolean;
  updatedAt: string;
}

@Injectable()
export class PoolTradingService {
  constructor(private readonly prisma: PrismaService) {}

  async setPaused(poolId: string, paused: boolean): Promise<PoolTradingState> {
    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
      select: { id: true },
    });
    if (!pool) {
      throw new NotFoundException(`Pool ${poolId} not found`);
    }

    const updated = await this.prisma.pool.update({
      where: { id: poolId },
      data: { active: !paused },
      select: { id: true, active: true, updatedAt: true },
    });

    return {
      poolId: updated.id,
      paused: !updated.active,
      active: updated.active,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
