/**
 * #973 — SDK error mapping from contract errors.
 *
 * Typed SDK errors with stable error codes, mapped from raw contract/Soroban
 * error codes. Unknown/unmapped contract errors fail closed into a generic
 * typed SDK error rather than being swallowed or treated as success.
 */

/** Stable SDK error codes. These are part of the public API surface. */
export enum SdkErrorCode {
  /** Unknown or unmapped contract error (fail-closed default). */
  UnknownContractError = 'SDK_UNKNOWN_CONTRACT_ERROR',
  /** Contract rejected the call due to invalid input. */
  InvalidInput = 'SDK_INVALID_INPUT',
  /** Caller is not authorized for the requested operation. */
  Unauthorized = 'SDK_UNAUTHORIZED',
  /** Insufficient balance for the requested operation. */
  InsufficientBalance = 'SDK_INSUFFICIENT_BALANCE',
  /** Slippage tolerance exceeded. */
  SlippageExceeded = 'SDK_SLIPPAGE_EXCEEDED',
  /** Pool or position was not found. */
  NotFound = 'SDK_NOT_FOUND',
  /** Operation would leave the pool in an invalid state. */
  InvalidPoolState = 'SDK_INVALID_POOL_STATE',
  /** Request was rejected as a replay/duplicate (idempotency). */
  Replay = 'SDK_REPLAY',
  /** A required dependency (RPC/DB/Redis) is unavailable. */
  DependencyUnavailable = 'SDK_DEPENDENCY_UNAVAILABLE',
}

/** Raw contract/Soroban error shape accepted by the mapper. */
export interface RawContractError {
  /** Numeric contract error code, if available. */
  code?: number | string;
  /** Human-readable message from the contract/RPC. */
  message?: string;
  /** Optional correlation id propagated from the caller. */
  correlationId?: string;
}

/**
 * Base typed SDK error. Preserves the original contract code/message and
 * carries a correlation id for observability (never secrets).
 */
export class SdkError extends Error {
  readonly code: SdkErrorCode;
  readonly contractCode?: number | string;
  readonly correlationId?: string;

  constructor(
    code: SdkErrorCode,
    message: string,
    options: { contractCode?: number | string; correlationId?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
    this.contractCode = options.contractCode;
    this.correlationId = options.correlationId;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Contract error code -> SDK error code mapping.
 * Codes are the stable numeric codes emitted by the Swyft contracts.
 */
export const CONTRACT_ERROR_CODE_MAP: Readonly<Record<number, SdkErrorCode>> = Object.freeze({
  1: SdkErrorCode.InvalidInput,
  2: SdkErrorCode.Unauthorized,
  3: SdkErrorCode.InsufficientBalance,
  4: SdkErrorCode.SlippageExceeded,
  5: SdkErrorCode.NotFound,
  6: SdkErrorCode.InvalidPoolState,
  7: SdkErrorCode.Replay,
  8: SdkErrorCode.DependencyUnavailable,
});

function normalizeCode(code: number | string | undefined): number | undefined {
  if (code === undefined) return undefined;
  if (typeof code === 'number') return Number.isFinite(code) ? code : undefined;
  const parsed = Number(code);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Map a raw contract/Soroban error into a typed {@link SdkError}.
 *
 * Fail-closed: unknown or unmapped codes surface as
 * {@link SdkErrorCode.UnknownContractError} instead of being swallowed.
 */
export function mapContractError(raw: RawContractError | unknown): SdkError {
  const input: RawContractError =
    raw && typeof raw === 'object' ? (raw as RawContractError) : { message: String(raw) };

  const numericCode = normalizeCode(input.code);
  const mapped = numericCode !== undefined ? CONTRACT_ERROR_CODE_MAP[numericCode] : undefined;
  const code = mapped ?? SdkErrorCode.UnknownContractError;

  const message =
    input.message ??
    (numericCode !== undefined
      ? `Contract error ${numericCode}`
      : 'Unknown contract error');

  return new SdkError(code, message, {
    contractCode: input.code,
    correlationId: input.correlationId,
    cause: raw,
  });
}

/**
 * Wrap an async contract call so any thrown error is mapped to a typed
 * {@link SdkError}, preserving the correlation id. Fail-closed on unknowns.
 */
export async function withContractErrorMapping<T>(
  fn: () => Promise<T>,
  correlationId?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SdkError) {
      if (correlationId && !err.correlationId) {
        throw new SdkError(err.code, err.message, {
          contractCode: err.contractCode,
          correlationId,
          cause: err,
        });
      }
      throw err;
    }
    const raw =
      err && typeof err === 'object'
        ? { ...(err as RawContractError), correlationId }
        : { message: String(err), correlationId };
    throw mapContractError(raw);
  }
}
