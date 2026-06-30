import { Swap, Pool, Token } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SwapsRepository } from './swaps.repository';

const makeSwap = (overrides: Partial<Swap> = {}): Swap =>
  ({
    id: 'swap-1',
    eventId: 'evt-1',
    poolId: 'pool-1',
    senderAddress: 'wallet-sender',
    recipientAddress: 'wallet-recipient',
    amount0: '100',
    amount1: '-50',
    sqrtPriceAfter: '79228162514264337593543950336', // 2^96 -> price = 1
    tickAfter: 0,
    transactionHash: 'tx-1',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Swap;

const makePool = (overrides: Partial<Pool> = {}): Pool =>
  ({
    id: 'pool-1',
    token0Address: 'USDC-addr',
    token1Address: 'XLM-addr',
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

describe('SwapsRepository', () => {
  const prisma = {
    swap: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    token: {
      findMany: jest.fn(),
    },
  };
  let repository: SwapsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new SwapsRepository(prisma as unknown as PrismaService);
  });

  it('queries, filters, and paginates swaps from Prisma', async () => {
    const swap = makeSwap();
    const pool = makePool();
    const swapWithPool = { ...swap, pool };

    prisma.swap.count.mockResolvedValue(1);
    prisma.swap.findMany.mockResolvedValue([swapWithPool]);
    prisma.token.findMany.mockResolvedValue([
      makeToken({ address: 'USDC-addr', symbol: 'USDC' }),
      makeToken({ address: 'XLM-addr', symbol: 'XLM' }),
    ]);

    const result = await repository.listSwaps({
      page: 1,
      limit: 10,
      poolId: 'pool-1',
      wallet: 'wallet-sender',
    });

    expect(prisma.swap.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        poolId: { equals: 'pool-1', mode: 'insensitive' },
        OR: [
          { senderAddress: { equals: 'wallet-sender', mode: 'insensitive' } },
          {
            recipientAddress: { equals: 'wallet-sender', mode: 'insensitive' },
          },
        ],
      }),
    });

    expect(prisma.swap.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        orderBy: { timestamp: 'desc' },
      }),
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'swap-1',
      poolId: 'pool-1',
      token0Symbol: 'USDC',
      token1Symbol: 'XLM',
      amount0: '100',
      amount1: '-50',
      priceAtSwap: '1',
      txHash: 'tx-1',
      walletAddress: 'wallet-sender',
      timestamp: new Date('2026-01-01T00:00:00.000Z').getTime(),
    });
  });

  it('returns empty list when no swaps match', async () => {
    prisma.swap.count.mockResolvedValue(0);
    prisma.swap.findMany.mockResolvedValue([]);

    const result = await repository.listSwaps({ page: 1, limit: 10 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
