import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { Pool } from '@prisma/client';

export type TvlAlertDirection = 'below' | 'above';

export interface TvlAlertThresholdCreate {
  poolId: string;
  thresholdUsd: number;
  direction: TvlAlertDirection;
}

@Injectable()
export class TvlAlertService {
  private readonly logger = new Logger(TvlAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooksService: WebhooksService,
  ) {}

  /**
   * Set or update a TVL alert threshold for a pool
   */
  async setThreshold(
    ownerWallet: string,
    data: TvlAlertThresholdCreate,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.tvlAlertThreshold.findUnique({
      where: { poolId_ownerWallet: { poolId: data.poolId, ownerWallet } },
    });

    if (existing) {
      const updated = await this.prisma.tvlAlertThreshold.update({
        where: { id: existing.id },
        data: {
          thresholdUsd: data.thresholdUsd,
          direction: data.direction,
          enabled: true,
          updatedAt: new Date(),
        },
      });
      return { id: updated.id };
    }

    const created = await this.prisma.tvlAlertThreshold.create({
      data: {
        poolId: data.poolId,
        ownerWallet,
        thresholdUsd: data.thresholdUsd,
        direction: data.direction,
        enabled: true,
      },
    });
    return { id: created.id };
  }

  /**
   * Get all TVL alert thresholds for a wallet
   */
  async listThresholds(ownerWallet: string) {
    return this.prisma.tvlAlertThreshold.findMany({
      where: { ownerWallet },
      include: {
        pool: {
          select: {
            id: true,
            token0Address: true,
            token1Address: true,
            feeTier: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Disable a TVL alert threshold
   */
  async disableThreshold(id: string, ownerWallet: string): Promise<void> {
    await this.prisma.tvlAlertThreshold.updateMany({
      where: { id, ownerWallet },
      data: { enabled: false, updatedAt: new Date() },
    });
  }

  /**
   * Delete a TVL alert threshold
   */
  async deleteThreshold(id: string, ownerWallet: string): Promise<void> {
    await this.prisma.tvlAlertThreshold.deleteMany({
      where: { id, ownerWallet },
    });
  }

  /**
   * Check TVL against thresholds and trigger alerts if needed
   * This should be called from the StatsWorker after updating TVL
   */
  async checkAndTriggerAlerts(
    pool: Pool,
    currentTvlUsd: number,
  ): Promise<void> {
    const thresholds = await this.prisma.tvlAlertThreshold.findMany({
      where: {
        poolId: pool.id,
        enabled: true,
        OR: [
          {
            direction: 'below',
            thresholdUsd: { gt: currentTvlUsd },
            lastTriggeredAt: null,
          },
          {
            direction: 'below',
            thresholdUsd: { gt: currentTvlUsd },
            lastTriggeredAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Only trigger once per day
          },
          {
            direction: 'above',
            thresholdUsd: { lt: currentTvlUsd },
            lastTriggeredAt: null,
          },
          {
            direction: 'above',
            thresholdUsd: { lt: currentTvlUsd },
            lastTriggeredAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Only trigger once per day
          },
        ],
      },
    });

    for (const threshold of thresholds) {
      try {
        const breachedAt = new Date();
        await this.prisma.tvlAlertHistory.create({
          data: {
            thresholdId: threshold.id,
            poolId: pool.id,
            ownerWallet: threshold.ownerWallet,
            thresholdUsd: threshold.thresholdUsd,
            observedTvlUsd: currentTvlUsd,
            direction: threshold.direction,
            breachedAt,
          },
        });

        // Update last triggered time
        await this.prisma.tvlAlertThreshold.update({
          where: { id: threshold.id },
          data: { lastTriggeredAt: breachedAt },
        });

        // Trigger webhook if user has webhooks set up for pool.tvl.milestone
        await this.webhooksService.dispatch('pool.tvl.milestone', {
          poolId: pool.id,
          token0: pool.token0Address,
          token1: pool.token1Address,
          tvlUsd: currentTvlUsd,
          threshold: threshold.thresholdUsd,
          direction: threshold.direction,
          crossedAt: breachedAt.toISOString(),
        });

        this.logger.log(
          `TVL alert triggered for pool=${pool.id}, owner=${threshold.ownerWallet}, threshold=${threshold.thresholdUsd}, direction=${threshold.direction}, current=${currentTvlUsd}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to trigger TVL alert for threshold=${threshold.id}: ${error}`,
        );
      }
    }
  }

  /**
   * Record TVL snapshot for historical time series
   */
  async recordTvlSnapshot(poolId: string, tvlUsd: number): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await this.prisma.tvlSnapshot.upsert({
        where: {
          poolId_date: {
            poolId,
            date: today,
          },
        },
        update: {
          tvlUsd,
        },
        create: {
          poolId,
          tvlUsd,
          date: today,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record TVL snapshot for pool=${poolId}: ${error}`,
      );
    }
  }

  /**
   * Get historical TVL time series for a pool
   */
  async getTvlHistory(poolId: string, startDate: Date, endDate: Date) {
    return this.prisma.tvlSnapshot.findMany({
      where: {
        poolId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        tvlUsd: true,
      },
    });
  }
}
