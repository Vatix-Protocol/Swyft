import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, nativeToScVal, rpc, scValToNative } from '@stellar/stellar-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { STELLAR_CONFIG_KEY, StellarConfig } from '../config/stellar.config';
import {
  InvalidInputException,
  UpstreamServiceException,
} from '../request-validation/http.exceptions';

/** Same wallet-address shape check used by `GetSwapsQueryDto`. */
const WALLET_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);
  private readonly rpcUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const stellarCfg = this.config.get<StellarConfig>(STELLAR_CONFIG_KEY)!;
    this.rpcUrl = stellarCfg.rpcUrl;
  }

  /**
   * Returns a map of SAC token contract address -> human-readable decimal
   * balance string for every token this API tracks (the `Token` table),
   * queried live from each token contract's `balance` function via Soroban
   * RPC simulation.
   *
   * A token whose contract simulation itself errors (e.g. a stale/malformed
   * row) is omitted from the response rather than reported as `"0"` — a
   * missing key means "unknown", never "confirmed zero". A network-level
   * failure reaching the RPC endpoint aborts the whole request with a 503
   * (`UpstreamServiceException`) instead of silently returning an empty or
   * partial map, so callers can't mistake an outage for real balances.
   */
  async getBalances(address: string): Promise<Record<string, string>> {
    if (!WALLET_ADDRESS_PATTERN.test(address ?? '')) {
      throw new InvalidInputException(
        'address must be a valid Stellar wallet address (G...)',
      );
    }

    const tokens = await this.prisma.token.findMany({
      select: { address: true, decimals: true },
    });

    if (tokens.length === 0) return {};

    const server = new rpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith('http://'),
    });

    const balances: Record<string, string> = {};

    for (const token of tokens) {
      let raw: bigint | undefined;
      try {
        raw = await this.fetchOnChainBalance(server, token.address, address);
      } catch (err) {
        throw new UpstreamServiceException(
          `Failed to reach the Stellar RPC endpoint while fetching balances: ${
            (err as Error).message
          }`,
        );
      }

      if (raw === undefined) {
        this.logger.warn(
          `balance() simulation for token ${token.address} did not return a value; omitting from response`,
        );
        continue;
      }

      balances[token.address] = this.fromBaseUnits(raw, token.decimals);
    }

    return balances;
  }

  /**
   * Simulates a call to `balance(address)` on a SAC token contract.
   * Returns `undefined` (not `0n`) when the simulation itself reports an
   * error, so the caller can distinguish "no value" from "genuinely zero".
   * Network/transport failures are left to throw — the caller classifies
   * those as an upstream outage.
   */
  private async fetchOnChainBalance(
    server: rpc.Server,
    tokenContractAddress: string,
    walletAddress: string,
  ): Promise<bigint | undefined> {
    const contract = new Contract(tokenContractAddress);
    const op = contract.call(
      'balance',
      nativeToScVal(walletAddress, { type: 'address' }),
    );
    const result = await server.simulateTransaction(
      op as unknown as Parameters<typeof server.simulateTransaction>[0],
    );

    if (rpc.Api.isSimulationError(result)) return undefined;
    if (!result.result) return undefined;

    const native = scValToNative(result.result.retval);
    if (typeof native === 'bigint') return native;
    if (typeof native === 'number' || typeof native === 'string') {
      return BigInt(native);
    }
    return undefined;
  }

  /** Converts an integer base-units bigint into a decimal string amount. */
  private fromBaseUnits(amount: bigint, decimals: number): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const frac = (amount % divisor)
      .toString()
      .padStart(decimals, '0')
      .replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  }
}
