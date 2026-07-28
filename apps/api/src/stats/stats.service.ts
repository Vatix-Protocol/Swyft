import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface GlobalStats {
  totalTvl: string;
  totalVolume24h: string;
  poolCount: number;
  activePositions: number;
  totalSwaps: number;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aggregates platform-wide stats across all pools. */
  async computeGlobalStats(): Promise<GlobalStats> {
    const [pools, activePositions, totalSwaps] = await Promise.all([
      this.prisma.pool.findMany({ select: { tvl: true, volume24h: true } }),
      this.prisma.position.count({ where: { closedAt: null } }),
      this.prisma.swap.count(),
    ]);

    const totalTvl = pools.reduce((sum, p) => sum + Number(p.tvl), 0);
    const totalVolume24h = pools.reduce(
      (sum, p) => sum + Number(p.volume24h),
      0,
    );

    return {
      totalTvl: String(totalTvl),
      totalVolume24h: String(totalVolume24h),
      poolCount: pools.length,
      activePositions,
      totalSwaps,
    };
  }
}
