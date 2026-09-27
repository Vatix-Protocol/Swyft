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

/**
 * Position NFT metadata standard (see `CONTRACTS.md`).
 *
 * A position NFT is the on-chain receipt for a liquidity position. Its
 * metadata is the canonical, server-validated description of that position
 * and MUST be derived from on-chain state — never trusted from a client.
 *
 * Invariants:
 *  - `positionId` is a non-empty, bounded-length opaque identifier.
 *  - `poolAddress` is a valid Stellar contract/wallet address (C.../G...).
 *  - `tickLower < tickUpper` and both are integers within the tick range.
 *  - `liquidity` is a non-negative integer base-units string.
 *  - `metadataVersion` is pinned to the current standard so consumers can
 *    detect drift; unknown versions fail closed.
 */
export const POSITION_NFT_METADATA_VERSION = 1 as const;

/** Tick bounds for the position NFT standard (matches contract tick range). */
export const POSITION_NFT_TICK_RANGE = {
  minTick: -887272,
  maxTick: 887272,
} as const;

/** Stable error codes for position NFT metadata validation failures. */
export const POSITION_NFT_ERROR_CODES = {
  INVALID_POSITION_ID: 'POSITION_NFT_INVALID_POSITION_ID',
  INVALID_POOL_ADDRESS: 'POSITION_NFT_INVALID_POOL_ADDRESS',
  INVALID_TICK_RANGE: 'POSITION_NFT_INVALID_TICK_RANGE',
  INVALID_LIQUIDITY: 'POSITION_NFT_INVALID_LIQUIDITY',
  UNSUPPORTED_METADATA_VERSION: 'POSITION_NFT_UNSUPPORTED_METADATA_VERSION',
  METADATA_UNAVAILABLE: 'POSITION_NFT_METADATA_UNAVAILABLE',
} as const;

export type PositionNftErrorCode =
  (typeof POSITION_NFT_ERROR_CODES)[keyof typeof POSITION_NFT_ERROR_CODES];

/** Canonical, validated position NFT metadata safe to expose to clients. */
export interface PositionNftMetadata {
  /** Opaque position identifier (token id). */
  positionId: string;
  /** Pool contract address the position belongs to. */
  poolAddress: string;
  /** Lower tick bound (inclusive). */
  tickLower: number;
  /** Upper tick bound (exclusive). */
  tickUpper: number;
  /** Non-negative liquidity in base units, as a decimal string. */
  liquidity: string;
  /** Metadata standard version this record conforms to. */
  metadataVersion: number;
  /** Correlation id echoed back for tracing/observability. */
  correlationId: string;
}

/** Raw, untrusted position NFT metadata input as supplied by a client. */
export interface PositionNftMetadataRequest {
  positionId?: string;
  poolAddress?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  metadataVersion?: number;
  correlationId?: string;
}

/** Contract/wallet address shape (C... contract or G... account). */
const CONTRACT_ADDRESS_PATTERN = /^C[A-Z2-7]{55}$/;
const MAX_POSITION_ID_LENGTH = 128;

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
   * Validates untrusted position NFT metadata against the standard defined
   * in `CONTRACTS.md` and returns the canonical, server-trusted record.
   *
   * Deny-by-default: any field that is missing, malformed, out of range, or
   * carries an unsupported `metadataVersion` is rejected with a stable error
   * code. The server never trusts client-supplied metadata as authoritative
   * for balances/settlement — this only normalizes and gates the shape so
   * downstream consumers can rely on the invariants. A missing correlation
   * id is generated so every rejection is traceable.
   */
  enforcePositionNftMetadata(
    request: PositionNftMetadataRequest,
  ): PositionNftMetadata {
    const correlationId = request.correlationId?.trim() || this.newCorrelationId();

    const positionId = request.positionId?.trim();
    if (
      !positionId ||
      positionId.length > MAX_POSITION_ID_LENGTH ||
      !/^[A-Za-z0-9:_-]+$/.test(positionId)
    ) {
      this.logger.warn(
        `[${correlationId}] rejected position NFT metadata: invalid positionId`,
      );
      throw new InvalidInputException(
        `${POSITION_NFT_ERROR_CODES.INVALID_POSITION_ID}: positionId must be a non-empty identifier of at most ${MAX_POSITION_ID_LENGTH} characters`,
      );
    }

    const poolAddress = request.poolAddress?.trim();
    if (
      !poolAddress ||
      !(
        CONTRACT_ADDRESS_PATTERN.test(poolAddress) ||
        WALLET_ADDRESS_PATTERN.test(poolAddress)
      )
    ) {
      this.logger.warn(
        `[${correlationId}] rejected position NFT metadata: invalid poolAddress`,
      );
      throw new InvalidInputException(
        `${POSITION_NFT_ERROR_CODES.INVALID_POOL_ADDRESS}: poolAddress must be a valid Stellar contract (C...) or account (G...) address`,
      );
    }

    const { tickLower, tickUpper } = request;
    if (
      typeof tickLower !== 'number' ||
      typeof tickUpper !== 'number' ||
      !Number.isInteger(tickLower) ||
      !Number.isInteger(tickUpper) ||
      tickLower < POSITION_NFT_TICK_RANGE.minTick ||
      tickUpper > POSITION_NFT_TICK_RANGE.maxTick ||
      tickLower >= tickUpper
    ) {
      this.logger.warn(
        `[${correlationId}] rejected position NFT metadata: invalid tick range [${String(
          tickLower,
        )}, ${String(tickUpper)})`,
      );
      throw new InvalidInputException(
        `${POSITION_NFT_ERROR_CODES.INVALID_TICK_RANGE}: tickLower/tickUpper must be integers with tickLower < tickUpper within [${POSITION_NFT_TICK_RANGE.minTick}, ${POSITION_NFT_TICK_RANGE.maxTick}]`,
      );
    }

    const liquidity = request.liquidity?.trim();
    if (!liquidity || !/^\d+$/.test(liquidity)) {
      this.logger.warn(
        `[${correlationId}] rejected position NFT metadata: invalid liquidity`,
      );
      throw new InvalidInputException(
        `${POSITION_NFT_ERROR_CODES.INVALID_LIQUIDITY}: liquidity must be a non-negative integer base-units string`,
      );
    }

    const metadataVersion =
      request.metadataVersion ?? POSITION_NFT_METADATA_VERSION;
    if (metadataVersion !== POSITION_NFT_METADATA_VERSION) {
      this.logger.warn(
        `[${correlationId}] rejected position NFT metadata: unsupported metadataVersion ${String(
          metadataVersion,
        )}`,
      );
      throw new InvalidInputException(
        `${POSITION_NFT_ERROR_CODES.UNSUPPORTED_METADATA_VERSION}: metadataVersion must be ${POSITION_NFT_METADATA_VERSION}`,
      );
    }

    return {
      positionId,
      poolAddress,
      tickLower,
      tickUpper,
      liquidity,
      metadataVersion,
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
      .pad

/* … truncated 329 chars — edit only what you need near the top … */
