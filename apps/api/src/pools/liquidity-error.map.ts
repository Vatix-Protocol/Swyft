import { HttpException, HttpStatus } from '@nestjs/common';
import { LiquidityOperationException } from '../request-validation/http.exceptions';
import { LiquidityError, LiquidityErrorCode } from './pool.types';

/**
 * HTTP translation for every LiquidityErrorCode. Typed as a full Record so
 * adding a code to pool.types.ts without a mapping is a compile error, and
 * liquidity-error.map.spec.ts enforces the same at runtime.
 */
export const LIQUIDITY_ERROR_HTTP_STATUS: Record<
  LiquidityErrorCode,
  HttpStatus
> = {
  LP_UNAUTHORIZED: HttpStatus.FORBIDDEN,
  LP_INVALID_AMOUNT: HttpStatus.BAD_REQUEST,
  LP_INVALID_TICK_RANGE: HttpStatus.BAD_REQUEST,
  LP_POOL_NOT_FOUND: HttpStatus.NOT_FOUND,
  LP_POOL_INACTIVE: HttpStatus.CONFLICT,
  LP_INSUFFICIENT_LIQUIDITY: HttpStatus.CONFLICT,
  LP_DEPENDENCY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  LP_REPLAY_DETECTED: HttpStatus.CONFLICT,
};

/**
 * Codes whose rejection is known to have left state untouched, surfaced to
 * clients as `applied: false`. A replay is the case clients must be able to
 * tell apart from a fresh failure: the original request was applied, this
 * one was not.
 */
const NOT_APPLIED_CODES = new Set<LiquidityErrorCode>([
  LiquidityErrorCode.LP_REPLAY_DETECTED,
]);

/**
 * Domain failure thrown by the LP mint/burn path. Throw this (not an
 * HttpException) from liquidity logic; it is translated to an HTTP response
 * by `translateLiquidityError` before reaching AllExceptionsFilter.
 */
export class LiquidityDomainError extends Error implements LiquidityError {
  constructor(
    readonly code: LiquidityErrorCode,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = 'LiquidityDomainError';
  }
}

/** Builds the HTTP exception for a liquidity failure. */
export function toLiquidityHttpException(
  error: LiquidityError,
): LiquidityOperationException {
  return new LiquidityOperationException(
    LIQUIDITY_ERROR_HTTP_STATUS[error.code],
    error.code,
    error.message,
    error.correlationId,
    NOT_APPLIED_CODES.has(error.code) ? false : undefined,
  );
}

/**
 * Translates anything thrown from the liquidity dependency path into an
 * HttpException:
 *  - LiquidityDomainError → its mapped status and stable body.
 *  - HttpException → unchanged (already carries a deliberate status).
 *  - anything else → LP_DEPENDENCY_UNAVAILABLE (503), fail-closed, instead
 *    of an opaque 500.
 */
export function translateLiquidityError(
  err: unknown,
  correlationId: string,
): HttpException {
  if (err instanceof LiquidityDomainError) {
    return toLiquidityHttpException(err);
  }
  if (err instanceof HttpException) {
    return err;
  }
  return toLiquidityHttpException({
    code: LiquidityErrorCode.LP_DEPENDENCY_UNAVAILABLE,
    message: 'A liquidity dependency is unavailable. Retry later.',
    correlationId,
  });
}
