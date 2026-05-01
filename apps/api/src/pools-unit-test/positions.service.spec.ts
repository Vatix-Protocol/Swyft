import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PositionsService } from '../../src/positions/positions.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import {
  createMockPrismaService,
  createMockRedisService,
  mockPosition,
  paginatedResponse,
} from '../test-utils/mock-factories';

/** Minimal JWT payload that the service expects after guard processing */
interface JwtPayload {
  sub: string;
  wallet: string;
  iat: number;
  exp: number;
}

const buildJwt = (wallet: string): JwtPayload => ({
  sub: `user_${wallet.slice(2, 10)}`,
  wallet,
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

describe('PositionsService', () => {
  let service: PositionsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedisService>;

  const walletA = '0xWalletOwner1';
  const walletB = '0xWalletOwner2';

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<PositionsService>(PositionsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Authentication gate ──────────────────────────────────────────────────

  describe('authentication', () => {
    it('throws UnauthorizedException when JWT payload is null', async () => {
      await expect(
        service.findByWallet(null as unknown as JwtPayload, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when JWT payload is undefined', async () => {
      await expect(
        service.findByWallet(undefined as unknown as JwtPayload, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when wallet field is missing from JWT', async () => {
      await expect(
        service.findByWallet({ sub: 'user_1' } as unknown as JwtPayload, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('does not throw for a valid JWT payload', async () => {
      prisma.position.count.mockResolvedValue(0);
      prisma.position.findMany.mockResolvedValue([]);

      await expect(
        service.findByWallet(buildJwt(walletA), {}),
      ).resolves.not.toThrow();
    });
  });

  // ─── findByWallet (happy path) ────────────────────────────────────────────

  describe('findByWallet()', () => {
    const positions = [
      mockPosition({ id: 'pos_1', owner: walletA }),
      mockPosition({ id: 'pos_2', owner: walletA }),
    ];

    it('returns positions owned by the authenticated wallet', async () => {
      prisma.position.count.mockResolvedValue(2);
      prisma.position.findMany.mockResolvedValue(positions);

      const result = await service.findByWallet(buildJwt(walletA), {
        page: 1,
        limit: 10,
      });

      expect(result).toEqual(paginatedResponse(positions, 2, 1, 10));
    });

    it('scopes the Prisma query to the JWT wallet address', async () => {
      prisma.position.count.mockResolvedValue(0);
      prisma.position.findMany.mockResolvedValue([]);

      await service.findByWallet(buildJwt(walletA), { page: 1, limit: 10 });

      expect(prisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ owner: walletA }),
        }),
      );
    });

    it('returns an empty array when wallet has no positions', async () => {
      prisma.position.count.mockResolvedValue(0);
      prisma.position.findMany.mockResolvedValue([]);

      const result = await service.findByWallet(buildJwt(walletB), {});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('wallet A cannot see wallet B positions — separate query scopes', async () => {
      // walletA query
      prisma.position.count.mockResolvedValueOnce(2);
      prisma.position.findMany.mockResolvedValueOnce(positions);
      await service.findByWallet(buildJwt(walletA), {});

      // walletB query
      prisma.position.count.mockResolvedValueOnce(0);
      prisma.position.findMany.mockResolvedValueOnce([]);
      const resultB = await service.findByWallet(buildJwt(walletB), {});

      expect(resultB.items).toEqual([]);

      const [callA] = (prisma.position.findMany as jest.Mock).mock.calls;
      const [callB] = (prisma.position.findMany as jest.Mock).mock.calls.slice(1);
      expect(callA[0].where.owner).toBe(walletA);
      expect(callB[0].where.owner).toBe(walletB);
    });
  });

  // ─── Filtering by status ──────────────────────────────────────────────────

  describe('findByWallet() — status filter', () => {
    it('filters by ACTIVE status', async () => {
      prisma.position.count.mockResolvedValue(1);
      prisma.position.findMany.mockResolvedValue([
        mockPosition({ status: 'ACTIVE' }),
      ]);

      await service.findByWallet(buildJwt(walletA), { status: 'ACTIVE' });

      expect(prisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('filters by CLOSED status', async () => {
      prisma.position.count.mockResolvedValue(1);
      prisma.position.findMany.mockResolvedValue([
        mockPosition({ status: 'CLOSED' }),
      ]);

      await service.findByWallet(buildJwt(walletA), { status: 'CLOSED' });

      expect(prisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
    });

    it('does not apply status filter when omitted', async () => {
      prisma.position.count.mockResolvedValue(2);
      prisma.position.findMany.mockResolvedValue([
        mockPosition({ status: 'ACTIVE' }),
        mockPosition({ id: 'pos_2', status: 'CLOSED' }),
      ]);

      await service.findByWallet(buildJwt(walletA), {});

      const [callArg] = (prisma.position.findMany as jest.Mock).mock.calls[0];
      expect(callArg?.where?.status).toBeUndefined();
    });

    it('returns only positions matching the requested status', async () => {
      const activePositions = [
        mockPosition({ status: 'ACTIVE' }),
        mockPosition({ id: 'pos_2', status: 'ACTIVE' }),
      ];
      prisma.position.count.mockResolvedValue(2);
      prisma.position.findMany.mockResolvedValue(activePositions);

      const result = await service.findByWallet(buildJwt(walletA), {
        status: 'ACTIVE',
      });

      expect(result.items.every((p) => p.status === 'ACTIVE')).toBe(true);
    });
  });

  // ─── Filtering by poolId ──────────────────────────────────────────────────

  describe('findByWallet() — pool filter', () => {
    it('filters by poolId', async () => {
      prisma.position.count.mockResolvedValue(1);
      prisma.position.findMany.mockResolvedValue([
        mockPosition({ poolId: 'pool_42' }),
      ]);

      await service.findByWallet(buildJwt(walletA), { poolId: 'pool_42' });

      expect(prisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ poolId: 'pool_42' }),
        }),
      );
    });

    it('combines poolId and status filters', async () => {
      prisma.position.count.mockResolvedValue(1);
      prisma.position.findMany.mockResolvedValue([
        mockPosition({ poolId: 'pool_42', status: 'ACTIVE' }),
      ]);

      await service.findByWallet(buildJwt(walletA), {
        poolId: 'pool_42',
        status: 'ACTIVE',
      });

      const [callArg] = (prisma.position.findMany as jest.Mock).mock.calls[0];
      expect(callArg.where.poolId).toBe('pool_42');
      expect(callArg.where.status).toBe('ACTIVE');
    });

    it('returns empty array when wallet has no positions in specified pool', async () => {
      prisma.position.count.mockResolvedValue(0);
      prisma.position.findMany.mockResolvedValue([]);

      const result = await service.findByWallet(buildJwt(walletA), {
        poolId: 'pool_nonexistent',
      });

      expect(result.items).toEqual([]);
    });
  });

  // ─── Pagination ───────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('calculates correct skip for page 2', async () => {
      prisma.position.count.mockResolvedValue(25);
      prisma.position.findMany.mockResolvedValue([]);

      await service.findByWallet(buildJwt(walletA), { page: 2, limit: 10 });

      expect(prisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('includes correct pages count in response', async () => {
      prisma.position.count.mockResolvedValue(25);
      prisma.position.findMany.mockResolvedValue([]);

      const result = await service.findByWallet(buildJwt(walletA), {
        page: 1,
        limit: 10,
      });

      expect(result.pages).toBe(3);
    });
  });

  // ─── Error propagation ────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('re-throws Prisma errors', async () => {
      prisma.position.count.mockRejectedValue(new Error('DB unavailable'));

      await expect(
        service.findByWallet(buildJwt(walletA), {}),
      ).rejects.toThrow('DB unavailable');
    });
  });
});
