import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SorobanRpc, Contract, scValToNative, xdr } from '@stellar/stellar-sdk';

interface TokenListEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface UniswapTokenList {
  tokens: TokenListEntry[];
}

@Injectable()
export class TokenEnrichmentService implements OnModuleInit {
  private readonly logger = new Logger(TokenEnrichmentService.name);
  private readonly prisma = new PrismaClient();
  private readonly rpcUrl: string;
  private readonly tokenListUrl: string | undefined;

  constructor() {
    this.rpcUrl = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
    this.tokenListUrl = process.env.TOKEN_LIST_URL;
  }

  onModuleInit() {
    void this.enrichAll();
    // Re-enrich weekly
    setInterval(() => void this.enrichAll(), 7 * 24 * 60 * 60 * 1000);
  }

  /** Called by the indexer whenever a new token address is discovered. */
  async enrichToken(contractAddress: string): Promise<void> {
    await this.upsertToken(contractAddress, await this.fetchTokenListMap());
  }

  private async enrichAll(): Promise<void> {
    const tokens = await this.prisma.token.findMany({ select: { contractAddress: true } });
    const listMap = await this.fetchTokenListMap();
    for (const { contractAddress } of tokens) {
      await this.upsertToken(contractAddress, listMap);
    }
  }

  private async upsertToken(
    contractAddress: string,
    listMap: Map<string, TokenListEntry>,
  ): Promise<void> {
    try {
      const onChain = await this.fetchOnChainMetadata(contractAddress);
      const listed = listMap.get(contractAddress.toLowerCase());

      await this.prisma.token.upsert({
        where: { contractAddress },
        update: {
          symbol: onChain.symbol ?? listed?.symbol ?? 'UNKNOWN',
          name: onChain.name ?? listed?.name ?? contractAddress,
          decimals: onChain.decimals ?? listed?.decimals ?? 7,
          logoUri: listed?.logoURI ?? null,
        },
        create: {
          contractAddress,
          symbol: onChain.symbol ?? listed?.symbol ?? 'UNKNOWN',
          name: onChain.name ?? listed?.name ?? contractAddress,
          decimals: onChain.decimals ?? listed?.decimals ?? 7,
          logoUri: listed?.logoURI ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not enrich token ${contractAddress}: ${(err as Error).message}`,
      );
    }
  }

  private async fetchOnChainMetadata(
    contractAddress: string,
  ): Promise<{ symbol?: string; name?: string; decimals?: number }> {
    const server = new SorobanRpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith('http://'),
    });
    const contract = new Contract(contractAddress);

    const call = async (method: string): Promise<unknown> => {
      const op = contract.call(method);
      const result = await server.simulateTransaction(
        op as unknown as Parameters<typeof server.simulateTransaction>[0],
      );
      if (SorobanRpc.Api.isSimulationError(result)) return undefined;
      const sim = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
      return sim.result ? scValToNative(sim.result.retval) : undefined;
    };

    const [symbol, name, decimals] = await Promise.all([
      call('symbol').catch(() => undefined),
      call('name').catch(() => undefined),
      call('decimals').catch(() => undefined),
    ]);

    return {
      symbol: typeof symbol === 'string' ? symbol : undefined,
      name: typeof name === 'string' ? name : undefined,
      decimals: typeof decimals === 'number' ? decimals : undefined,
    };
  }

  private async fetchTokenListMap(): Promise<Map<string, TokenListEntry>> {
    if (!this.tokenListUrl) return new Map();
    try {
      const res = await fetch(this.tokenListUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as UniswapTokenList;
      return new Map(list.tokens.map((t) => [t.address.toLowerCase(), t]));
    } catch (err) {
      this.logger.warn(`Could not fetch token list: ${(err as Error).message}`);
      return new Map();
    }
  }
}
