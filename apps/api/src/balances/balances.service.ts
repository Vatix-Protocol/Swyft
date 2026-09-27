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

/**
 * Server-side slippage policy. Clients may request a tolerance, but the
 * server clamps it into these bounds and is the source of truth for the
 * value that is ultimately enforced on-chain. `maxToleranceBps` is the
 * hard ceiling an untrusted client can never exceed; `minToleranceBps`
 * rejects adversarial zero/negative tolerances that would grief fills.
 */
export const SLIPPAGE_POLICY = {
  minToleranceBps: 1,
  maxToleranceBps: 500,
  maxDeadlineSeconds: 300,
  minDeadlineSeconds: 5,
} as const;

/** Stable error codes for slippage validation failures. */
export const SLIPPAGE_ERROR_CODES = {
  INVALID_TOLERANCE: 'SLIPPAGE_INVALID_TOLERANCE',
  INVALID_DEADLINE: 'SLIPPAGE_INVALID_DEADLINE',
  POLICY_UNAVAILABLE: 'SLIPPAGE_POLICY_UNAVAILABLE',
} as const;

export type SlippageErrorCode =
  (typeof SLIPPAGE_ERROR_CODES)[keyof typeof SLIPPAGE_ERROR_CODES];

/** Validated, server-clamped slippage parameters safe to enforce on-chain. */
export interface EnforcedSlippageParams {
  /** Clamped tolerance in basis points (1 bps = 0.01%). */
  toleranceBps: number;
  /** Absolute unix-seconds deadline derived from the requested window. */
  deadline: number;
  /** Correlation id echoed back for tracing/observability. */
  correlationId: string;
}

/** Raw, untrusted slippage input as supplied by a client. */
export interface SlippageRequest {
  toleranceBps?: number;
  deadlineSeconds?: number;
  correlationId?: string;
}

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
   * Validates and clamps untrusted slippage parameters into the server-side
   * policy bounds. This is the single source of truth for slippage: the
   * returned `toleranceBps`/`deadline` are what must be enforced on-chain,
   * so a client cannot widen tolerance or extend the deadline past policy.
   *
   * Fails closed: malformed or out-of-range input throws with a stable error
   * code rather than silently defaulting, and a missing correlation id is
   * generated so every rejection is traceable.
   */
  enforceSlippageParams(request: SlippageRequest): EnforcedSlippageParams {
    const correlationId = request.correlationId?.trim() || this.newCorrelationId();

    const toleranceBps = request.toleranceBps;
    if (
      typeof toleranceBps !== 'number' ||
      !Number.isInteger(toleranceBps) ||
      toleranceBps < SLIPPAGE_POLICY.minToleranceBps ||
      toleranceBps > SLIPPAGE_POLICY.maxToleranceBps
    ) {
      this.logger.warn(
        `[${correlationId}] rejected slippage tolerance ${String(
          toleranceBps,
        )} outside [${SLIPPAGE_POLICY.minToleranceBps}, ${SLIPPAGE_POLICY.maxToleranceBps}] bps`,
      );
      throw new InvalidInputException(
        `${SLIPPAGE_ERROR_CODES.INVALID_TOLERANCE}: toleranceBps must be an integer between ${SLIPPAGE_POLICY.minToleranceBps} and ${SLIPPAGE_POLICY.maxToleranceBps}`,
      );
    }

    const deadlineSeconds = request.deadlineSeconds;
    if (
      typeof deadlineSeconds !== 'number' ||
      !Number.isInteger(deadlineSeconds) ||
      deadlineSeconds < SLIPPAGE_POLICY.minDeadlineSeconds ||
      deadlineSeconds > SLIPPAGE_POLICY.maxDeadlineSeconds
    ) {
      this.logger.warn(
        `[${correlationId}] rejected slippage deadline ${String(
          deadlineSeconds,
        )}s outside [${SLIPPAGE_POLICY.minDeadlineSeconds}, ${SLIPPAGE_POLICY.maxDeadlineSeconds}]s`,
      );
      throw new InvalidInputException(
        `${SLIPPAGE_ERROR_CODES.INVALID_DEADLINE}: deadlineSeconds must be an integer between ${SLIPPAGE_POLICY.minDeadlineSeconds} and ${SLIPPAGE_POLICY.maxDeadlineSeconds}`,
      );
    }

    return {
      toleranceBps,
      deadline: Math.floor(Date.now() / 1000) + deadlineSeconds,
      correlationId,
    };
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

  /** Generates a correlation id for tracing slippage validation failures. */
  private newCorrelationId(): string {
    return `slp_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}
