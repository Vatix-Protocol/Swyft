import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchTokenResult {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri: string | null;
}

export interface SearchPoolResult {
  poolId: string;
  tokenA: string;
  tokenB: string;
  tokenASymbol: string | null;
  tokenBSymbol: string | null;
  fee: string;
}

export interface SearchResponse {
  tokens: SearchTokenResult[];
  pools: SearchPoolResult[];
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(rawQuery: string): Promise<SearchResponse> {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return { tokens: [], pools: [] };
    }

    const [tokens, pools] = await Promise.all([
      this.searchTokens(query),
      this.searchPools(query),
    ]);

    return { tokens, pools };
  }

  private searchTokens(query: string): Promise<SearchTokenResult[]> {
    return this.prisma.$queryRawUnsafe<SearchTokenResult[]>(
      `
        SELECT
          "contractAddress",
          "symbol",
          "name",
          "decimals",
          "logoUri"
        FROM "token"
        WHERE
          lower("contractAddress") = lower($1)
          OR "symbol" ILIKE $2
          OR "name" ILIKE $3
        ORDER BY
          CASE
            WHEN lower("symbol") = lower($1) THEN 0
            WHEN lower("contractAddress") = lower($1) THEN 0
            WHEN "symbol" ILIKE $2 THEN 1
            WHEN "name" ILIKE $3 THEN 2
            ELSE 3
          END,
          "symbol" ASC,
          "name" ASC
        LIMIT 10
      `,
      query,
      `${query}%`,
      `%${query}%`,
    );
  }

  private searchPools(query: string): Promise<SearchPoolResult[]> {
    return this.prisma.$queryRawUnsafe<SearchPoolResult[]>(
      `
        SELECT
          p."poolId",
          p."tokenA",
          p."tokenB",
          token_a."symbol" AS "tokenASymbol",
          token_b."symbol" AS "tokenBSymbol",
          p."fee"
        FROM "pool_created" p
        LEFT JOIN "token" token_a ON lower(token_a."contractAddress") = lower(p."tokenA")
        LEFT JOIN "token" token_b ON lower(token_b."contractAddress") = lower(p."tokenB")
        WHERE
          lower(p."poolId") = lower($1)
          OR token_a."symbol" ILIKE $2
          OR token_b."symbol" ILIKE $2
          OR p."tokenA" ILIKE $2
          OR p."tokenB" ILIKE $2
        ORDER BY
          CASE
            WHEN lower(p."poolId") = lower($1) THEN 0
            WHEN lower(token_a."symbol") = lower($1) THEN 0
            WHEN lower(token_b."symbol") = lower($1) THEN 0
            WHEN token_a."symbol" ILIKE $2 OR token_b."symbol" ILIKE $2 THEN 1
            ELSE 2
          END,
          p."poolId" ASC
        LIMIT 10
      `,
      query,
      `${query}%`,
    );
  }
}
