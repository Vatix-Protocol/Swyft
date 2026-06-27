import { Position, Pool, Token } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PositionsRepository } from './positions.repository';

const makePosition = (overrides: Partial<Position> = {}): Position =>
  ({
    id: 'pos-1',
    poolId: 'pool-1',
    ownerAddress: 'wallet-owner',
    tokenId: '1',
    lowerTick: -60,
    upperTick: 60,
    liquidity: '50',
    feesCollected0: '1',
    feesCollected1: '2',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    closedAt: null,
    ...overrides,
  }) as Position;

const makePool = (overrides: Partial<Pool> = {}): Pool =>
  ({
    id: 'pool-1',
    token0Address: 'USDC-addr',
    token1Address: 'XLM-addr',
    feeTier: 30,
    currentSqrtPrice: '1',
    currentTick: 0,
    liquidity: '100', // pool liquidity
    tvl: '1000', // pool tvl
    volume24h: '50',
    feeApr: '2.5',
    currentPrice: '1.25',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }) as Pool;

const makeToken = (overrides: Partial<Token> = {}): Token =>
  ({
    id: 'tok-1',
    address: 'USDC-addr',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUri: null,
    ...overrides,
  }) as Token;

describe('PositionsRepository', () => {
  const prisma = {
    position: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    token: {
      findMany: jest.fn(),
    },
  };
  let repository: PositionsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new PositionsRepository(prisma as unknown as PrismaService);
  });

  it('queries, filters, and paginates positions from Prisma', async () => {
    const position = makePosition();
    const pool = makePool();
    const posWithPool = { ...position, pool };

    prisma.position.count.mockResolvedValue(1);
    prisma.position.findMany.mockResolvedValue([posWithPool]);
    prisma.token.findMany.mockResolvedValue([
      makeToken({ address: 'USDC-addr', symbol: 'USDC' }),
      makeToken({ address: 'XLM-addr', symbol: 'XLM' }),
    ]);

    const result = await repository.listPositionsByWallet('wallet-owner', {
      page: 1,
      limit: 10,
      status: 'active',
      pool: 'pool-1',
    });

    expect(prisma.position.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerAddress: { equals: 'wallet-owner', mode: 'insensitive' },
        closedAt: null,
        poolId: { equals: 'pool-1', mode: 'insensitive' },
      }),
    });

    expect(prisma.position.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);

    // currentValueUsd = (posLiquidity / poolLiquidity) * poolTvl
    // (50 / 100) * 1000 = 500
    expect(result.items[0]).toEqual({
      id: 'pos-1',
      ownerWallet: 'wallet-owner',
      poolId: 'pool-1',
      token0: 'USDC',
      token1: 'XLM',
      lowerTick: -60,
      upperTick: 60,
      liquidity: '50',
      currentValueUsd: 500,
      uncollectedFeesToken0: '1',
      uncollectedFeesToken1: '2',
      createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
      closedAt: null,
      status: 'active',
      poolCurrentPrice: 1.25,
    });
  });

  it('filters by closed status correctly', async () => {
    prisma.position.count.mockResolvedValue(0);
    prisma.position.findMany.mockResolvedValue([]);

    await repository.listPositionsByWallet('wallet-owner', {
      page: 1,
      limit: 10,
      status: 'closed',
    });

    expect(prisma.position.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        closedAt: { not: null },
      }),
    });
  });

  it('returns empty list when no positions match', async () => {
    prisma.position.count.mockResolvedValue(0);
    prisma.position.findMany.mockResolvedValue([]);

    const result = await repository.listPositionsByWallet('wallet-owner', {
      page: 1,
      limit: 10,
      status: 'all',
    });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
