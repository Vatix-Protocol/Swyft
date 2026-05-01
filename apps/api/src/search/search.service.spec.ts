import { SearchService } from './search.service';

describe('SearchService', () => {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
  };

  beforeEach(() => {
    prisma.$queryRawUnsafe.mockReset();
  });

  it('returns empty results for queries under two characters without hitting the database', async () => {
    const service = new SearchService(prisma as never);

    await expect(service.search(' u ')).resolves.toEqual({ tokens: [], pools: [] });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns separate token and pool arrays', async () => {
    const token = {
      contractAddress: 'GUSDC',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 7,
      logoUri: null,
    };
    const pool = {
      poolId: 'pool-1',
      tokenA: 'GUSDC',
      tokenB: 'GXLM',
      tokenASymbol: 'USDC',
      tokenBSymbol: 'XLM',
      fee: '30',
    };

    prisma.$queryRawUnsafe.mockResolvedValueOnce([token]).mockResolvedValueOnce([pool]);
    const service = new SearchService(prisma as never);

    await expect(service.search('usd')).resolves.toEqual({
      tokens: [token],
      pools: [pool],
    });
  });

  it('asks the database to rank exact symbols before prefix and contains matches', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new SearchService(prisma as never);

    await service.search('usdc');

    const tokenSql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(tokenSql).toContain('WHEN lower("symbol") = lower($1) THEN 0');
    expect(tokenSql).toContain('WHEN "symbol" ILIKE $2 THEN 1');
    expect(tokenSql).toContain('WHEN "name" ILIKE $3 THEN 2');
  });

  it('returns empty arrays when no matches are found', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new SearchService(prisma as never);

    await expect(service.search('zz')).resolves.toEqual({ tokens: [], pools: [] });
  });
});
