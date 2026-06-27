import {
  Contract,
  Keypair,
  TransactionBuilder,
  Networks,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';

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

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an unsigned swap transaction XDR from provided swap parameters.
 *
 * Constructs a real Soroban transaction that invokes the swap method on a router
 * contract. The transaction is built with a placeholder source account and must be
 * properly signed before submission.
 *
 * @param params - Swap parameters including pool ID, token IDs, amounts, and owner.
 * @returns An unsigned swap transaction envelope in base-64 XDR format.
 * @throws {SwapValidationError} If parameters are invalid (invalid addresses or amounts).
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

    const swapOp = contract.call('swap', tokenInScVal, tokenOutScVal, amountInScVal, minOutScVal);

    const sourceKeypair = Keypair.random();
    const sourceAccount = {
      accountId: sourceKeypair.publicKey(),
      sequence: '0',
    };

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: Networks.TESTNET_NETWORK_PASSPHRASE,
    });

    txBuilder.addOperation(swapOp);
    const tx = txBuilder.setTimeout(30).build();

    const xdrString = tx.toEnvelope().toXDR('base64');
    return { xdr: xdrString as XdrBase64, type: 'swap' };
  } catch (err) {
    if (err instanceof SwapValidationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SwapValidationError(`Failed to build swap transaction: ${message}`);
  }
}
