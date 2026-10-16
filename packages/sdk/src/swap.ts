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
 * is not provided. It gives the wallet time to prompt/sign while expiring stale
 * transactions promptly.
 */
export const DEFAULT_SWAP_DEADLINE_SECONDS = 120;

/** Hard upper bound on how long a swap transaction may remain executable. */
export const MAX_SWAP_DEADLINE_SECONDS = 300;

/**
 * Parameters for building an exact-input single-hop swap transaction.
 *
 * @remarks
 * This interface invokes the router contract's exact_input_single method,
 * which enforces deadline and slippage protections before executing the swap.
 * This is the only safe entrypoint for production swaps.
 */
export interface SwapTxParams {
  /** On-chain router contract address (must start with 'C'). */
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
   * Pool fee tier to route through (e.g., 3000 = 0.3%). Defaults to 3000.
   *
   * @remarks
   * This is passed to router.exact_input_single so it can resolve the correct pool
   * from the factory registry.
   */
  readonly feeTier?: number;
  /**
   * Unix timestamp (seconds) after which the swap must no longer execute.
   * Defaults to `now + {@link DEFAULT_SWAP_DEADLINE_SECONDS}`.
   * Must be no more than {@link MAX_SWAP_DEADLINE_SECONDS} seconds in the future.
   *
   * The deadline is enforced two ways:
   * - It is passed as an explicit `deadline` argument to the router contract's
   *   `exact_input_single` method, so the contract can reject stale calls itself.
   * - It is also set as the transaction's `maxTime` precondition, so Stellar
   *   Core rejects submission of an expired envelope outright (`txTOO_LATE`)
   *   even before the contract call is evaluated.
   */
  readonly deadline?: number;
  /**
   * Optional caller-supplied source account for the unsigned transaction.
   *
   * @remarks
   * When provided, the transaction is built deterministically from this account
   * so identical parameters yield byte-identical XDR (useful for snapshotting
   * and diffing). When omitted, a random placeholder keypair is used as before.
   */
  readonly sourceAccount?: Account;
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

function resolveSwapDeadline(requestedDeadline?: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const deadline = requestedDeadline ?? nowSeconds + DEFAULT_SWAP_DEADLINE_SECONDS;

  if (
    !Number.isSafeInteger(deadline) ||
    deadline <= nowSeconds ||
    deadline - nowSeconds > MAX_SWAP_DEADLINE_SECONDS
  ) {
    throw new SwapValidationError(
      `Invalid deadline: must be a future unix timestamp no more than ${MAX_SWAP_DEADLINE_SECONDS} seconds away. Got: ${requestedDeadline}`,
    );
  }

  return deadline;
}

/**
 * Resolves the source account used to build the unsigned transaction.
 *
 * When the caller supplies an explicit `sourceAccount`, it is used verbatim so
 * that identical parameters produce byte-identical XDR. Otherwise a random
 * placeholder keypair is generated, preserving the previous behaviour for
 * callers that do not care about determinism.
 */
function resolveSourceAccount(sourceAccount?: Account): Account {
  return sourceAccount ?? new Account(Keypair.random().publicKey(), '0');
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
   * Must be no more than {@link MAX_SWAP_DEADLINE_SECONDS} seconds in the future.
   */
  readonly deadline?: number;
  /**
   * Optional caller-supplied source account for the unsigned transaction.
   *
   * @remarks
   * When provided, the transaction is built deterministically from this account
   * so identical parameters yield byte-identical XDR. When omitted, a random
   * placeholder keypair is used as before.
   */
  readonly sourceAccount?: Account;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an unsigned swap transaction XDR from provided swap parameters.
 *
 * Constructs a real Soroban transaction that invokes the exact_input_single method
 * on the router contract. The router enforces deadline and slippage protections,
 * making this the only safe entrypoint for production swaps.
 *
 * The transaction is built with a placeholder source account and must be
 * properly signed before submission. Pass {@link SwapTxParams.sourceAccount} to
 * make the resulting XDR deterministic for identical parameters.
 *
 * The swap carries a deadline (see {@link SwapTxParams.deadline}) to prevent stale
 * execution: it is forwarded as a contract call argument and also encoded as the
 * transaction's `maxTime` precondition, so an expired swap is rejected at the
 * Stellar protocol level (`txTOO_LATE`) in addition to any contract-side check.
 *
 * @param params - Swap parameters including router ID, token IDs, amounts, and owner.
 * @returns An unsigned swap transaction envelope in base-64 XDR format.
 * @throws {SwapValidationError} If parameters are invalid (invalid addresses, amounts, or a deadline outside the allowed TTL).
 */
export function buildSwapTx(params: SwapTxParams): SwapUnsignedTx {
  if (!isValidStellarAddress(params.poolId)) {
    throw new SwapValidationError(`Invalid poolId: ${params.poolId}`);
  }
  if (!isValidStellarAddress(params.tokenInId)) {
    throw new SwapValidationError(`Invalid tokenInId: ${params.tokenInId}`);
  }
  if (!isValidStellarAddress(params.tokenOutId)) {
    throw new SwapValidationError(`Invalid tokenOutId: ${params.tokenOutId}`);
  }
  if (!isValidStellarAddress(params.ownerAddress)) {
    throw new SwapValidationError(`Invalid ownerAddress: ${params.ownerAddress}`);
  }
  if (!isValidAmount(params.amountIn)) {
    throw new SwapValidationError(`Invalid amountIn: ${params.amountIn}`);
  }
  if (!isValidAmount(params.minimumReceived)) {
    throw new SwapValidationError(`Invalid minimumReceived: ${params.minimumReceived}`);
  }

  const deadline = resolveSwapDeadline(params.deadline);
  const sourceAccount = resolveSourceAccount(params.sourceAccount);

  const contract = new Contract(params.poolId);
  const operation = contract.call(
    'exact_input_single',
    nativeToScVal(params.ownerAddress, { type: 'address' }),
    nativeToScVal(params.tokenInId, { type: 'address' }),
    nativeToScVal(params.tokenOutId, { type: 'address' }),
    nativeToScVal(params.amountIn, { type: 'i128' }),
    nativeToScVal(params.minimumReceived, { type: 'i128' }),
    nativeToScVal(params.feeTier ?? 3000, { type: 'u32' }),
    nativeToScVal(deadline, { type: 'u64' }),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: config.networkPassphrase ?? Networks.TESTNET,
    timebounds: { minTime: 0, maxTime: deadline },
  })
    .addOperation(operation)
    .setTimeout(0)
    .build();

  return {
    xdr: toXdrBase64(tx.toXDR()),
    type: 'swap',
  };
}

/**
 * Builds an unsigned exact-output single-hop swap transaction XDR.
 *
 * Constructs a Soroban transaction that invokes the router's
 * `exact_output_single` entrypoint, where the caller specifies the exact amount
 * of `tokenOut` they want and a maximum amount of `tokenIn` they are willing to
 * spend. Pass {@link ExactOutputSwapTxParams.sourceAccount} to make the
 * resulting XDR deterministic for identical parameters.
 *
 * @param params - Exact-output swap parameters.
 * @returns An unsigned swap transaction envelope in base-64 XDR format.
 * @throws {SwapValidationError} If parameters are invalid.
 */
export function buildExactOutputSwapTx(params: ExactOutputSwapTxParams): SwapUnsignedTx {
  if (!isValidStellarAddress(params.routerId)) {
    throw new SwapValidationError(`Invalid routerId: ${params.routerId}`);
  }
  if (!isValidStellarAddress(params.tokenInId)) {
    throw new SwapValidationError(`Invalid tokenInId: ${params.tokenInId}`);
  }
  if (!isValidStellarAddress(params.tokenOutId)) {
    throw new SwapValidationError(`Invalid tokenOutId: ${params.tokenOutId}`);
  }
  if (!isValidStellarAddress(params.ownerAddress)) {
    throw new SwapValidationError(`Invalid ownerAddress: ${params.ownerAddress}`);
  }
  if (!isValidAmount(params.amountOut)) {
    throw new SwapValidationError(`Invalid amountOut: ${params.amountOut}`);
  }
  if (!isValidAmount(params.amountInMax)) {
    throw new SwapValidationError(`Invalid amountInMax: ${params.amountInMax}`);
  }

  const deadline = resolveSwapDeadline(params.deadline);
  const sourceAccount = resolveSourceAccount(params.sourceAccount);

  const contract = new Contract(params.routerId);
  const operation = contract.call(
    'exact_output_single',
    nativeToScVal(params.ownerAddress, { type: 'address' }),
    nativeToScVal(params.tokenInId, { type: 'address' }),
    nativeToScVal(params.tokenOutId, { type: 'address' }),
    nativeToScVal(params.amountOut, { type: 'i128' }),
    nativeToScVal(params.amountInMax, { type: 'i128' }),
    nativeToScVal(params.fee, { type: 'u32' }),
    nativeToScVal(deadline, { type: 'u64' }),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: config.networkPassphrase ?? Networks.TESTNET,
    timebounds: { minTime: 0, maxTime: deadline },
  })
    .addOperation(operation)
    .setTimeout(0)
    .build();

  return {
    xdr: toXdrBase64(tx.toXDR()),
    type: 'swap',
  };
}
