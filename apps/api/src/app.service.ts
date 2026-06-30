import { Injectable } from '@nestjs/common';
import { CacheService } from './cache/cache.service';
import { PrismaService } from './prisma/prisma.service';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  checks: { postgres: boolean; redis: boolean };
}

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<HealthStatus> {
    const [postgres, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      this.cache.ping(),
    ]);
    return {
      status: postgres && redis ? 'ok' : 'degraded',
      checks: { postgres, redis },
    };
  }
}
