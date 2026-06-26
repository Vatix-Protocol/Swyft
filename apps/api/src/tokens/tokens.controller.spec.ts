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
});
