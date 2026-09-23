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

  async search(
    rawQuery: string,
    rawLimit = 10,
    rawOffset = 0,
  ): Promise<SearchResponse> {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return { tokens: [], pools: [] };
    }
    const limit = Math.min(Math.max(Math.trunc(rawLimit) || 10, 1), 50);
    const offset = Math.max(Math.trunc(rawOffset) || 0, 0);

    const [tokens, pools] = await Promise.all([
      this.searchTokens(query, limit, offset),
      this.searchPools(query, limit, offset),
    ]);

    return { tokens, pools };
  }

  private searchTokens(
    query: string,
    limit: number,
    offset: number,
  ): Promise<SearchTokenResult[]> {
    const tsPrefix = (query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .map((term) => `${term}:*`)
      .join(' & ');
    return (
      this.prisma.$queryRawUnsafe as (
        sql: string,
        ...values: unknown[]
      ) => Promise<SearchTokenResult[]>
    )(
      `
        SELECT
          "address" AS "contractAddress",
          "symbol",
          "name",
          "decimals",
          "logoUri"
        FROM "token"
        WHERE
          lower("address") = lower($1)
          OR "symbol" ILIKE $2
          OR "name" ILIKE $3
          OR (
            $4 <> ''
            AND to_tsvector('simple', "symbol") @@ to_tsquery('simple', $4)
          )
        ORDER BY
          CASE
            WHEN lower("symbol") = lower($1) THEN 0
            WHEN lower("address") = lower($1) THEN 0
            WHEN "symbol" ILIKE $2 THEN 1
            WHEN $4 <> '' AND to_tsvector('simple', "symbol") @@ to_tsquery('simple', $4) THEN 1
            WHEN "name" ILIKE $3 THEN 2
            ELSE 3
          END,
          "symbol" ASC,
          "name" ASC
        LIMIT $5 OFFSET $6
      `,
      query,
      `${query}%`,
      `%${query}%`,
      tsPrefix,
      limit,
      offset,
    );
  }

  private searchPools(
    query: string,
    limit: number,
    offset: number,
  ): Promise<SearchPoolResult[]> {
    return (
      this.prisma.$queryRawUnsafe as (
        sql: string,
        ...values: unknown[]
      ) => Promise<SearchPoolResult[]>
    )(
      `
        SELECT
          p."poolId",
          p."tokenA",
          p."tokenB",
          token_a."symbol" AS "tokenASymbol",
          token_b."symbol" AS "tokenBSymbol",
          p."fee"
        FROM "pool_created" p
        LEFT JOIN "token" token_a ON lower(token_a."address") = lower(p."tokenA")
        LEFT JOIN "token" token_b ON lower(token_b."address") = lower(p."tokenB")
        LEFT JOIN "pool" pool ON pool."id" = p."poolId"
        WHERE
          lower(p."poolId") = lower($1)
          OR token_a."symbol" ILIKE $2
          OR token_b."symbol" ILIKE $2
          OR p."tokenA" ILIKE $2
          OR p."tokenB" ILIKE $2
        ORDER BY
          COALESCE(NULLIF(pool."volume24h", '')::numeric, 0) DESC,
          p."poolId" ASC
        LIMIT $3 OFFSET $4
      `,
      query,
      `${query}%`,
      limit,
      offset,
    );
  }
}
