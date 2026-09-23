import { TokensController } from './tokens.controller';

describe('TokensController', () => {
  const prisma = {
    token: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    prisma.token.findMany.mockReset();
  });

  it('queries tokens ordered by symbol and maps address to contractAddress', async () => {
    prisma.token.findMany.mockResolvedValueOnce([
      {
        address: 'GUSDC',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 7,
        logoUri: null,
      },
    ]);
    const controller = new TokensController(prisma as never);

    await expect(controller.getTokens()).resolves.toEqual([
      {
        contractAddress: 'GUSDC',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 7,
        logoUri: null,
      },
    ]);
    expect(prisma.token.findMany).toHaveBeenCalledWith({
      orderBy: { symbol: 'asc' },
      skip: 0,
      take: 50,
      select: {
        address: true,
        symbol: true,
        name: true,
        decimals: true,
        logoUri: true,
      },
    });
  });

  it('returns an empty list when there are no tokens', async () => {
    prisma.token.findMany.mockResolvedValueOnce([]);
    const controller = new TokensController(prisma as never);

    await expect(controller.getTokens()).resolves.toEqual([]);
  });

  describe('pagination', () => {
    it('defaults to page 1 with a limit of 50 when no query is given', async () => {
      prisma.token.findMany.mockResolvedValueOnce([]);
      const controller = new TokensController(prisma as never);

      await controller.getTokens();

      expect(prisma.token.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('applies skip/take for a given page and limit', async () => {
      prisma.token.findMany.mockResolvedValueOnce([]);
      const controller = new TokensController(prisma as never);

      await controller.getTokens({ page: 3, limit: 20 });

      expect(prisma.token.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
    });

    it('caps take at the maximum page size when limit is at its max', async () => {
      prisma.token.findMany.mockResolvedValueOnce([]);
      const controller = new TokensController(prisma as never);

      await controller.getTokens({ page: 1, limit: 100 });

      expect(prisma.token.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
