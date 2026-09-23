import { Test, TestingModule } from '@nestjs/testing';
import { TvlAlertService } from './tvl-alert.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { Pool } from '@prisma/client';

describe('TvlAlertService', () => {
  let service: TvlAlertService;
  let prisma: jest.Mocked<PrismaService>;
  let webhooks: jest.Mocked<WebhooksService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TvlAlertService,
        {
          provide: PrismaService,
          useValue: {
            tvlAlertThreshold: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            tvlSnapshot: {
              upsert: jest.fn(),
              findMany: jest.fn(),
            },
            tvlAlertHistory: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            dispatch: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TvlAlertService>(TvlAlertService);
    prisma = module.get<PrismaService>(
      PrismaService,
    ) as jest.Mocked<PrismaService>;
    webhooks = module.get<WebhooksService>(
      WebhooksService,
    ) as jest.Mocked<WebhooksService>;
  });

  describe('setThreshold', () => {
    it('should create a new threshold when none exists', async () => {
      prisma.tvlAlertThreshold.findUnique.mockResolvedValue(null);
      prisma.tvlAlertThreshold.create.mockResolvedValue({
        id: 'threshold-1',
        poolId: 'pool-1',
        ownerWallet: 'owner-1',
        thresholdUsd: 1000000,
        direction: 'below',
        enabled: true,
        lastTriggeredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.setThreshold('owner-1', {
        poolId: 'pool-1',
        thresholdUsd: 1000000,
        direction: 'below',
      });

      expect(result).toEqual({ id: 'threshold-1' });
      expect(prisma.tvlAlertThreshold.create).toHaveBeenCalledWith({
        data: {
          poolId: 'pool-1',
          ownerWallet: 'owner-1',
          thresholdUsd: 1000000,
          direction: 'below',
          enabled: true,
        },
      });
    });

    it('should update existing threshold', async () => {
      const existing = {
        id: 'threshold-1',
        poolId: 'pool-1',
        ownerWallet: 'owner-1',
        thresholdUsd: 500000,
        direction: 'below',
        enabled: true,
        lastTriggeredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.tvlAlertThreshold.findUnique.mockResolvedValue(existing);
      prisma.tvlAlertThreshold.update.mockResolvedValue({
        ...existing,
        thresholdUsd: 1000000,
      });

      const result = await service.setThreshold('owner-1', {
        poolId: 'pool-1',
        thresholdUsd: 1000000,
        direction: 'below',
      });

      expect(result).toEqual({ id: 'threshold-1' });
      expect(prisma.tvlAlertThreshold.update).toHaveBeenCalledWith({
        where: { id: 'threshold-1' },
        data: {
          thresholdUsd: 1000000,
          direction: 'below',
          enabled: true,
          updatedAt: expect.any(Date),
        },
      });
    });
  });

  describe('checkAndTriggerAlerts', () => {
    const mockPool = {
      id: 'pool-1',
      token0Address: 'token-a',
      token1Address: 'token-b',
    } as Pool;

    it('should trigger alert when TVL drops below threshold', async () => {
      const threshold = {
        id: 'threshold-1',
        poolId: 'pool-1',
        ownerWallet: 'owner-1',
        thresholdUsd: 1000000,
        direction: 'below',
        enabled: true,
        lastTriggeredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.tvlAlertThreshold.findMany.mockResolvedValue([threshold]);
      prisma.tvlAlertThreshold.update.mockResolvedValue(threshold);
      webhooks.dispatch.mockResolvedValue();

      await service.checkAndTriggerAlerts(mockPool, 900000);

      expect(prisma.tvlAlertHistory.create).toHaveBeenCalledWith({
        data: {
          thresholdId: 'threshold-1',
          poolId: 'pool-1',
          ownerWallet: 'owner-1',
          thresholdUsd: 1000000,
          observedTvlUsd: 900000,
          direction: 'below',
          breachedAt: expect.any(Date),
        },
      });
      expect(prisma.tvlAlertThreshold.update).toHaveBeenCalledWith({
        where: { id: 'threshold-1' },
        data: { lastTriggeredAt: expect.any(Date) },
      });
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        'pool.tvl.milestone',
        expect.any(Object),
      );
    });

    it('should not trigger alert when TVL is above threshold', async () => {
      const threshold = {
        id: 'threshold-1',
        poolId: 'pool-1',
        ownerWallet: 'owner-1',
        thresholdUsd: 1000000,
        direction: 'below',
        enabled: true,
        lastTriggeredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.tvlAlertThreshold.findMany.mockResolvedValue([]);

      await service.checkAndTriggerAlerts(mockPool, 1100000);

      expect(prisma.tvlAlertThreshold.update).not.toHaveBeenCalled();
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('recordTvlSnapshot', () => {
    it('should record TVL snapshot', async () => {
      prisma.tvlSnapshot.upsert.mockResolvedValue({
        id: 'snapshot-1',
        poolId: 'pool-1',
        tvlUsd: 1000000,
        date: new Date(),
        createdAt: new Date(),
      });

      await service.recordTvlSnapshot('pool-1', 1000000);

      expect(prisma.tvlSnapshot.upsert).toHaveBeenCalledWith({
        where: {
          poolId_date: {
            poolId: 'pool-1',
            date: expect.any(Date),
          },
        },
        update: {
          tvlUsd: 1000000,
        },
        create: {
          poolId: 'pool-1',
          tvlUsd: 1000000,
          date: expect.any(Date),
        },
      });
    });
  });
});
