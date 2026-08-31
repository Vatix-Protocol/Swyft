import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  Networks,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';

import { config } from "./config";

// ── Branded primitives ────────────────────────────────────────────────────────

/**
 * A Stellar / Soroban contract address (C… or G… strkey).
 * Using a branded type prevents accidentally passing a raw string where an
 * address is expected, and vice-versa.
 */
export type StellarAddress = string & { readonly __brand: 'StellarAddress' };

/**
 * A raw token amount represented as a decimal string to avoid JS bigint loss.
 * Example: "1000000" (1 USDC with 6 decimals).
 */
export type RawAmount = string & { readonly __brand: 'RawAmount' };

/**
 * A base-64 encoded Soroban XDR envelope string.
 */
export type XdrBase64 = string & { readonly __brand: 'XdrBase64' };

// ── Helper casts ──────────────────────────────────────────────────────────────

/** Cast a plain string to {@link StellarAddress}. Use only at trust boundaries. */
export const toStellarAddress = (s: string): StellarAddress => s as StellarAddress;

/** Cast a plain string to {@link RawAmount}. Use only at trust boundaries. */
export const toRawAmount = (s: string): RawAmount => s as RawAmount;

/** Cast a plain string to {@link XdrBase64}. Use only at trust boundaries. */
export const toXdrBase64 = (s: string): XdrBase64 => s as XdrBase64;

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Identifies a pool by its two token addresses. */
export interface PoolId {
  readonly token0: StellarAddress;
  readonly token1: StellarAddress;
}

/**
 * Default swap deadline window, in seconds, applied when {@link SwapTxParams.deadline}
 * is not provided. Chosen to give a wallet enough time to prompt/sign while still
 * bounding how stale a swap can execute.
 */
export const DEFAULT_SWAP_DEADLINE_SECONDS = 600;

/**
 * Parameters for building an exact-input single-hop swap transaction.
 *
 * @remarks
 * This interface is intended for a simplified swap builder and does not
 * include advanced route construction or multi-hop trade details.
 */
export interface SwapTxParams {
  /** On-chain pool contract address used to execute the swap. */
  readonly poolId: StellarAddress;
  /** Contract address of the token being sold. */
  readonly tokenInId: StellarAddress;
  /** Contract address of the token being bought. */
  readonly tokenOutId: StellarAddress;
  /** Raw amount of `tokenIn` to sell (as a string to avoid JS bigint loss). */
  readonly amountIn: RawAmount;
  /** Minimum amount of `tokenOut` that must be received after slippage. */
  readonly minimumReceived: RawAmount;
  /** Stellar account address of the transaction submitter / recipient. */
  readonly ownerAddress: StellarAddress;
  /** Slippage tolerance in basis points (e.g., 50 = 0.5%). Defaults to 50. */
  readonly slippageBps?: number;
  /**
   * Unix timestamp (seconds) after which the swap must no longer execute.
   * Defaults to `now + {@link DEFAULT_SWAP_DEADLINE_SECONDS}`.
   *
   * The deadline is enforced two ways:
   * - It is passed as an explicit `deadline` argument to the pool contract's
   *   `swap` invocation, so the contract can reject stale calls itself.
   * - It is also set as the transaction's `maxTime` precondition, so Stellar
   *   Core rejects submission of an expired envelope outright (`txTOO_LATE`)
   *   even before the contract call is evaluated.
   */
  readonly deadline?: number;
}

/**
 * An unsigned Soroban swap transaction envelope ready for wallet signing.
 */
export interface SwapUnsignedTx {
  /** Base-64 encoded XDR of the transaction envelope. */
  readonly xdr: XdrBase64;
  /** Discriminant so callers can narrow the union type. */
  readonly type: 'swap';
}

// ── Validation ────────────────────────────────────────────────────────────────

function isValidStellarAddress(address: string): boolean {
  return (
    typeof address === 'string' &&
    address.length === 56 &&
    (address.startsWith('G') || address.startsWith('C'))
  );
}

function isValidAmount(amount: string): boolean {
  try {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && Number.isFinite(num);
  } catch {
    return false;
  }
}

export class SwapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapValidationError';
  }
}

/**
 * Parameters for building an exact-output single-hop swap transaction via
 * the router's `exact_output_single` entrypoint — the caller specifies the
 * exact amount of `tokenOut` they want and a maximum amount of `tokenIn`
 * they are willing to spend (the inverse of {@link SwapTxParams}).
 */
export interface ExactOutputSwapTxParams {
  /** On-chain router contract address used to execute the swap. */
  readonly routerId: StellarAddress;
  /** Contract address of the token being sold. */
  readonly tokenInId: StellarAddress;
  /** Contract address of the token being bought. */
  readonly tokenOutId: StellarAddress;
  /** Pool fee tier to route through. */
  readonly fee: number;
  /** Exact raw amount of `tokenOut` the caller wants to receive. */
  readonly amountOut: RawAmount;
  /** Maximum raw amount of `tokenIn` the caller is willing to spend. */
  readonly amountInMax: RawAmount;
  /** Stellar account address of the transaction submitter / recipient. */
  readonly ownerAddress: StellarAddress;
  /**
   * Unix timestamp (seconds) after which the swap must no longer execute.
   * Defaults to `now + {@link DEFAULT_SWAP_DEADLINE_SECONDS}`.
   */
  readonly deadline?: number;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an unsigned swap transaction XDR from provided swap parameters.
 *
 * Constructs a real Soroban transaction that invokes the swap method on a router
 * contract. The transaction is built with a placeholder source account and must be
 * properly signed before submission.
 *
 * The swap carries a deadline (see {@link SwapTxParams.deadline}) to prevent stale
 * execution: it is forwarded as a contract call argument and also encoded as the
 * transaction's `maxTime` precondition, so an expired swap is rejected at the
 * Stellar protocol level (`txTOO_LATE`) in addition to any contract-side check.
 *
 * @param params - Swap parameters including pool ID, token IDs, amounts, and owner.
 * @returns An unsigned swap transaction envelope in base-64 XDR format.
 * @throws {SwapValidationError} If parameters are invalid (invalid addresses, amounts, or an already-expired deadline).
 */
export function buildSwapTx(params: SwapTxParams): SwapUnsignedTx {
  if (!isValidStellarAddress(params.poolId)) {
    throw new SwapValidationError(
      `Invalid poolId: must be a valid Stellar address. Got: ${params.poolId}`
    );
  }
  if (!isValidStellarAddress(params.tokenInId)) {
    throw new SwapValidationError(
      `Invalid tokenInId: must be a valid Stellar address. Got: ${params.tokenInId}`
    );
  }
  if (!isValidStellarAddress(params.tokenOutId)) {
    throw new SwapValidationError(
      `Invalid tokenOutId: must be a valid Stellar address. Got: ${params.tokenOutId}`
    );
  }
  if (!isValidStellarAddress(params.ownerAddress)) {
    throw new SwapValidationError(
      `Invalid ownerAddress: must be a valid Stellar address. Got: ${params.ownerAddress}`
    );
  }
  if (!isValidAmount(params.amountIn)) {
    throw new SwapValidationError(
      `Invalid amountIn: must be a positive number. Got: ${params.amountIn}`
    );
  }
  if (!isValidAmount(params.minimumReceived)) {
    throw new SwapValidationError(
      `Invalid minimumReceived: must be a positive number. Got: ${params.minimumReceived}`
    );
  }
  if (params.slippageBps !== undefined) {
    const slippage = params.slippageBps;
    if (typeof slippage !== 'number' || slippage < 0 || slippage > 10000) {
      throw new SwapValidationError(
        `Invalid slippageBps: must be between 0 and 10000. Got: ${slippage}`
      );
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const deadline = params.deadline ?? nowSeconds + DEFAULT_SWAP_DEADLINE_SECONDS;

  if (!Number.isInteger(deadline) || deadline <= nowSeconds) {
    throw new SwapValidationError(
      `Invalid deadline: must be a future unix timestamp (seconds). Got: ${params.deadline}`
    );
  }

  try {
    const contract = new Contract(params.poolId);

    const amountInScVal = nativeToScVal(params.amountIn, {
      type: 'i128',
    });
    const minOutScVal = nativeToScVal(params.minimumReceived, {
      type: 'i128',
    });
    const tokenInScVal = nativeToScVal(params.tokenInId, {
      type: 'address',
    });
    const tokenOutScVal = nativeToScVal(params.tokenOutId, {
      type: 'address',
    });
    const deadlineScVal = nativeToScVal(deadline, { type: 'u64' });

    const swapOp = contract.call(
      'swap',
      tokenInScVal,
      tokenOutScVal,
      amountInScVal,
      minOutScVal,
      deadlineScVal
    );

    const sourceKeypair = Keypair.random();
    const sourceAccount = new Account(sourceKeypair.publicKey(), "0");

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: "100000",
      networkPassphrase: config.networkPassphrase,
      timebounds: { minTime: 0, maxTime: deadline },
    });

    txBuilder.addOperation(swapOp);
    const tx = txBuilder.build();

    const xdrString = tx.toEnvelope().toXDR('base64');
    return { xdr: xdrString as XdrBase64, type: 'swap' };
  } catch (err) {
    if (err instanceof SwapValidationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SwapValidationError(`Failed to build swap transaction: ${message}`);
  }
}

/**
 * Builds an unsigned exact-output swap transaction XDR that invokes the
 * router's `exact_output_single` entrypoint. Use this when the user wants
 * to receive an exact amount of `tokenOut` and cap how much `tokenIn` is
 * spent, rather than selling an exact amount of `tokenIn` (see
 * {@link buildSwapTx} for the exact-input path).
 *
 * @param params - Exact-output swap parameters including router ID, token
 *   IDs, fee tier, amounts, and owner.
 * @returns An unsigned swap transaction envelope in base-64 XDR format.
 * @throws {SwapValidationError} If parameters are invalid (invalid
 *   addresses, amounts, fee tier, or an already-expired deadline).
 */
export function buildExactOutputSwapTx(params: ExactOutputSwapTxParams): SwapUnsignedTx {
  if (!isValidStellarAddress(params.routerId)) {
    throw new SwapValidationError(
      `Invalid routerId: must be a valid Stellar address. Got: ${params.routerId}`
    );
  }
  if (!isValidStellarAddress(params.tokenInId)) {
    throw new SwapValidationError(
      `Invalid tokenInId: must be a valid Stellar address. Got: ${params.tokenInId}`
    );
  }
  if (!isValidStellarAddress(params.tokenOutId)) {
    throw new SwapValidationError(
      `Invalid tokenOutId: must be a valid Stellar address. Got: ${params.tokenOutId}`
    );
  }
  if (!isValidStellarAddress(params.ownerAddress)) {
    throw new SwapValidationError(
      `Invalid ownerAddress: must be a valid Stellar address. Got: ${params.ownerAddress}`
    );
  }
  if (!isValidAmount(params.amountOut)) {
    throw new SwapValidationError(
      `Invalid amountOut: must be a positive number. Got: ${params.amountOut}`
    );
  }
  if (!isValidAmount(params.amountInMax)) {
    throw new SwapValidationError(
      `Invalid amountInMax: must be a positive number. Got: ${params.amountInMax}`
    );
  }
  if (!Number.isInteger(params.fee) || params.fee < 0) {
    throw new SwapValidationError(`Invalid fee: must be a non-negative integer. Got: ${params.fee}`);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const deadline = params.deadline ?? nowSeconds + DEFAULT_SWAP_DEADLINE_SECONDS;

  if (!Number.isInteger(deadline) || deadline <= nowSeconds) {
    throw new SwapValidationError(
      `Invalid deadline: must be a future unix timestamp (seconds). Got: ${params.deadline}`
    );
  }

  try {
    const contract = new Contract(params.routerId);

    const paramsScVal = nativeToScVal(
      {
        token_in: params.tokenInId,
        token_out: params.tokenOutId,
        fee: params.fee,
        recipient: params.ownerAddress,
        deadline,
        amount_out: params.amountOut,
        amount_in_max: params.amountInMax,
        sqrt_price_limit_x96: '0',
      },
      {
        type: {
          token_in: ['symbol', 'address'],
          token_out: ['symbol', 'address'],
          fee: ['symbol', 'u32'],
          recipient: ['symbol', 'address'],
          deadline: ['symbol', 'u64'],
          amount_out: ['symbol', 'i128'],
          amount_in_max: ['symbol', 'i128'],
          sqrt_price_limit_x96: ['symbol', 'i128'],
        },
      }
    );

    const swapOp = contract.call('exact_output_single', paramsScVal);

    const sourceKeypair = Keypair.random();
    const sourceAccount = new Account(sourceKeypair.publicKey(), '0');

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
      timebounds: { minTime: 0, maxTime: deadline },
    });

    txBuilder.addOperation(swapOp);
    const tx = txBuilder.build();

    const xdrString = tx.toEnvelope().toXDR('base64');
    return { xdr: xdrString as XdrBase64, type: 'swap' };
  } catch (err) {
    if (err instanceof SwapValidationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SwapValidationError(`Failed to build exact-output swap transaction: ${message}`);
  }
}
