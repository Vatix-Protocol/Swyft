import { Pool } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PoolsRepository } from './pools.repository';

const makePool = (overrides: Partial<Pool> = {}): Pool =>
  ({
    id: 'pool-1',
    token0Address: 'USDC',
    token1Address: 'XLM',
    feeTier: 30,
    currentSqrtPrice: '1',
    currentTick: 0,
    liquidity: '0',
    tvl: '100',
    volume24h: '50',
    feeApr: '2.5',
    currentPrice: '1.25',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }) as Pool;

describe('PoolsRepository', () => {
  const prisma = {
    pool: {
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    tick: { findMany: jest.fn() },
  };
  let repository: PoolsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new PoolsRepository(prisma as unknown as PrismaService);
  });

  it('reads, sorts, and paginates pool snapshots from Prisma', async () => {
    prisma.pool.findMany.mockResolvedValue([
      makePool({ id: 'pool-low', tvl: '10' }),
      makePool({ id: 'pool-high', tvl: '100' }),
      makePool({ id: 'pool-mid', tvl: '50' }),
    ]);

    const result = await repository.listActivePools({
      page: 2,
      limit: 1,
      orderBy: 'tvl',
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'pool-mid',
          currentPrice: 1.25,
          active: true,
        }),
      ],
      total: 3,
    });
    expect(prisma.pool.findMany).toHaveBeenCalledWith({ where: undefined });
  });

  it('breaks ties on equal tvl deterministically by id', async () => {
    prisma.pool.findMany.mockResolvedValue([
      makePool({ id: 'pool-b', tvl: '100' }),
      makePool({ id: 'pool-a', tvl: '100' }),
    ]);

    const result = await repository.listActivePools({
      page: 1,
      limit: 10,
      orderBy: 'tvl',
    });

    expect(result.items.map((p) => p.id)).toEqual(['pool-a', 'pool-b']);
  });

  it('uses a case-insensitive database search for token addresses', async () => {
    prisma.pool.findMany.mockResolvedValue([]);

    await repository.listActivePools({
      page: 1,
      limit: 20,
      orderBy: 'volume',
      search: '  usdc ',
    });

    expect(prisma.pool.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { token0Address: { contains: 'usdc', mode: 'insensitive' } },
          { token1Address: { contains: 'usdc', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('persists a valid price update through Prisma', async () => {
    prisma.pool.update.mockResolvedValue(makePool({ currentPrice: '2.5' }));

    await repository.upsertPoolState('pool-1', { currentPrice: '2.5' });

    expect(prisma.pool.update).toHaveBeenCalledWith({
      where: { id: 'pool-1' },
      data: { currentPrice: '2.5' },
    });
  });

  it('ignores malformed values and a pool that has not been indexed yet', async () => {
    await repository.upsertPoolState('pool-1', { currentPrice: 'not-a-price' });
    expect(prisma.pool.update).not.toHaveBeenCalled();

    prisma.pool.update.mockRejectedValue({ code: 'P2025' });
    await expect(
      repository.upsertPoolState('not-yet-indexed', { currentPrice: '1' }),
    ).resolves.toBeUndefined();
  });
});
