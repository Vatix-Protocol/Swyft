jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(),
  Prisma: {},
}));

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

    await expect(service.search(' u ')).resolves.toEqual({
      tokens: [],
      pools: [],
    });
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

    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([token])
      .mockResolvedValueOnce([pool]);
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

  it('full-text searches token symbol prefixes through the GIN expression', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new SearchService(prisma as never);

    await service.search('usdc');

    const tokenSql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    const tokenArgs = prisma.$queryRawUnsafe.mock.calls[0].slice(1);
    expect(tokenSql).toContain(
      `to_tsvector('simple', "symbol") @@ to_tsquery('simple', $4)`,
    );
    expect(tokenArgs).toEqual(['usdc', 'usdc%', '%usdc%', 'usdc:*', 10, 0]);
  });

  it('clamps pagination and passes it to both indexed queries', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new SearchService(prisma as never);

    await service.search('usd', 1000, 20);

    expect(prisma.$queryRawUnsafe.mock.calls[0].slice(-2)).toEqual([50, 20]);
    expect(prisma.$queryRawUnsafe.mock.calls[1].slice(-2)).toEqual([50, 20]);
  });

  it('returns empty arrays when no matches are found', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new SearchService(prisma as never);

    await expect(service.search('zz')).resolves.toEqual({
      tokens: [],
      pools: [],
    });
  });

  it('ranks pools by volume descending then pool id for equal-volume ties', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const service = new SearchService(prisma as never);

    await service.search('usdc');

    const poolSql = prisma.$queryRawUnsafe.mock.calls[1][0] as string;
    expect(poolSql).toContain(
      'LEFT JOIN "pool" pool ON pool."id" = p."poolId"',
    );
    expect(poolSql).toContain(
      'COALESCE(NULLIF(pool."volume24h", \'\')::numeric, 0) DESC',
    );
    expect(poolSql).toContain('p."poolId" ASC');
  });

  it('documents a stable equal-volume fixture order (volume desc, poolId asc)', () => {
    // Fixture mirrors the SQL ORDER BY contract for tied volumes.
    const fixtures = [
      { poolId: 'pool-b', volume24h: '1000' },
      { poolId: 'pool-a', volume24h: '1000' },
      { poolId: 'pool-c', volume24h: '5000' },
    ];

    const ranked = [...fixtures].sort((a, b) => {
      const volumeDiff = Number(b.volume24h) - Number(a.volume24h);
      return volumeDiff !== 0 ? volumeDiff : a.poolId.localeCompare(b.poolId);
    });

    expect(ranked.map((p) => p.poolId)).toEqual(['pool-c', 'pool-a', 'pool-b']);
  });
});
