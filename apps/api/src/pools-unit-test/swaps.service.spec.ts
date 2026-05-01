import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SwapsService } from '../../src/swaps/swaps.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import {
  createMockPrismaService,
  createMockRedisService,
  mockSwap,
  paginatedResponse,
} from '../test-utils/mock-factories';

describe('SwapsService', () => {
  let service: SwapsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedisService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<SwapsService>(SwapsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── findAll (paginated list) ─────────────────────────────────────────────

  describe('findAll()', () => {
    const swaps = [
      mockSwap({ id: 'swap_1' }),
      mockSwap({ id: 'swap_2' }),
      mockSwap({ id: 'swap_3' }),
    ];

    it('returns paginated swaps with correct metadata', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(3);
      prisma.swap.findMany.mockResolvedValue(swaps);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual(paginatedResponse(swaps, 3, 1, 10));
    });

    it('returns cached result when cache is warm', async () => {
      const cached = paginatedResponse(swaps, 3, 1, 10);
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual(cached);
      expect(prisma.swap.findMany).not.toHaveBeenCalled();
    });

    it('applies correct skip for subsequent pages', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(50);
      prisma.swap.findMany.mockResolvedValue(swaps);

      await service.findAll({ page: 4, limit: 10 });

      expect(prisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 30, take: 10 }),
      );
    });

    it('returns empty items when no swaps match', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(0);
      prisma.swap.findMany.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('orders swaps by timestamp desc by default', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(0);
      prisma.swap.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 10 });

      expect(prisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.objectContaining({ timestamp: 'desc' }),
        }),
      );
    });
  });

  // ─── Filtering by poolId ──────────────────────────────────────────────────

  describe('findAll() — poolId filter', () => {
    it('passes poolId where-clause to Prisma', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(2);
      prisma.swap.findMany.mockResolvedValue([
        mockSwap({ poolId: 'pool_42' }),
        mockSwap({ id: 'swap_2', poolId: 'pool_42' }),
      ]);

      await service.findAll({ page: 1, limit: 10, poolId: 'pool_42' });

      expect(prisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ poolId: 'pool_42' }),
        }),
      );
    });

    it('only returns swaps belonging to the requested pool', async () => {
      redis.get.mockResolvedValue(null);
      const poolSwaps = [
        mockSwap({ poolId: 'pool_42' }),
        mockSwap({ id: 'swap_2', poolId: 'pool_42' }),
      ];
      prisma.swap.count.mockResolvedValue(2);
      prisma.swap.findMany.mockResolvedValue(poolSwaps);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        poolId: 'pool_42',
      });

      expect(result.items.every((s) => s.poolId === 'pool_42')).toBe(true);
    });

    it('does NOT add poolId filter when param is absent', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(0);
      prisma.swap.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 10 });

      const [callArg] = (prisma.swap.findMany as jest.Mock).mock.calls[0];
      expect(callArg?.where?.poolId).toBeUndefined();
    });
  });

  // ─── Filtering by wallet address ──────────────────────────────────────────

  describe('findAll() — wallet address filter', () => {
    const wallet = '0xWalletSender1';

    it('passes wallet address filter to Prisma', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(1);
      prisma.swap.findMany.mockResolvedValue([mockSwap({ sender: wallet })]);

      await service.findAll({ page: 1, limit: 10, wallet });

      expect(prisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ sender: wallet }),
              expect.objectContaining({ recipient: wallet }),
            ]),
          }),
        }),
      );
    });

    it('returns swaps where wallet is either sender or recipient', async () => {
      redis.get.mockResolvedValue(null);
      const walletSwaps = [
        mockSwap({ sender: wallet }),
        mockSwap({ id: 'swap_2', recipient: wallet }),
      ];
      prisma.swap.count.mockResolvedValue(2);
      prisma.swap.findMany.mockResolvedValue(walletSwaps);

      const result = await service.findAll({ page: 1, limit: 10, wallet });

      expect(result.items).toHaveLength(2);
    });

    it('combines poolId and wallet filters simultaneously', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(1);
      prisma.swap.findMany.mockResolvedValue([
        mockSwap({ poolId: 'pool_1', sender: wallet }),
      ]);

      await service.findAll({ page: 1, limit: 10, poolId: 'pool_1', wallet });

      const [callArg] = (prisma.swap.findMany as jest.Mock).mock.calls[0];
      expect(callArg?.where?.poolId).toBe('pool_1');
      expect(callArg?.where?.OR).toBeDefined();
    });
  });

  // ─── Validation / 400 errors ──────────────────────────────────────────────

  describe('findAll() — invalid params → 400', () => {
    it('throws BadRequestException when page is 0', async () => {
      await expect(
        service.findAll({ page: 0, limit: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when page is negative', async () => {
      await expect(
        service.findAll({ page: -1, limit: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when limit is 0', async () => {
      await expect(
        service.findAll({ page: 1, limit: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when limit exceeds maximum', async () => {
      await expect(
        service.findAll({ page: 1, limit: 1001 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when wallet address is malformed', async () => {
      await expect(
        service.findAll({ page: 1, limit: 10, wallet: 'not_an_address' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT throw for a valid Ethereum address', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockResolvedValue(0);
      prisma.swap.findMany.mockResolvedValue([]);

      await expect(
        service.findAll({
          page: 1,
          limit: 10,
          wallet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        }),
      ).resolves.not.toThrow();
    });
  });

  // ─── Error propagation ────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('re-throws database errors', async () => {
      redis.get.mockResolvedValue(null);
      prisma.swap.count.mockRejectedValue(new Error('Prisma error'));

      await expect(service.findAll({ page: 1, limit: 10 })).rejects.toThrow(
        'Prisma error',
      );
    });
  });
});
