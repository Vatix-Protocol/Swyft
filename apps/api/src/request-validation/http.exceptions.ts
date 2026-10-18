import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

// ── 400 ─────────────────────────────────────────────────────────────────────

export class InvalidInputException extends BadRequestException {
  constructor(message: string) {
    super({ message, error: 'Bad Request' });
  }
}

export class UnknownTokenException extends BadRequestException {
  constructor(address: string) {
    super({
      message: `Unknown token address: ${address}`,
      error: 'Bad Request',
      code: 'UNKNOWN_TOKEN',
    });
  }
}

// ── 401 ─────────────────────────────────────────────────────────────────────

export class MissingTokenException extends UnauthorizedException {
  constructor() {
    super({
      message: 'Authentication token is missing',
      error: 'Unauthorized',
    });
  }
}

export class InvalidTokenException extends UnauthorizedException {
  constructor() {
    super({
      message: 'Authentication token is invalid or expired',
      error: 'Unauthorized',
    });
  }
}

// ── 403 ─────────────────────────────────────────────────────────────────────

export class InsufficientPermissionsException extends ForbiddenException {
  constructor(action?: string) {
    super({
      message: action
        ? `You do not have permission to ${action}`
        : 'You do not have permission to perform this action',
      error: 'Forbidden',
    });
  }
}

// ── 404 ─────────────────────────────────────────────────────────────────────

export class ResourceNotFoundException extends NotFoundException {
  constructor(resource: string, identifier?: string | number) {
    super({
      message: identifier
        ? `${resource} with identifier '${identifier}' was not found`
        : `${resource} was not found`,
      error: 'Not Found',
    });
  }
}

// ── 409 ─────────────────────────────────────────────────────────────────────

export class DuplicateResourceException extends ConflictException {
  constructor(resource: string, field?: string) {
    super({
      message: field
        ? `${resource} with this ${field} already exists`
        : `${resource} already exists`,
      error: 'Conflict',
    });
  }
}

// ── 422 ─────────────────────────────────────────────────────────────────────

export class BusinessRuleViolationException extends UnprocessableEntityException {
  constructor(message: string) {
    super({ message, error: 'Unprocessable Entity' });
  }
}

export class SlippageExceededException extends UnprocessableEntityException {
  constructor() {
    super({
      message: 'Swap rejected: slippage tolerance exceeded',
      error: 'Unprocessable Entity',
    });
  }
}

// ── 503 ─────────────────────────────────────────────────────────────────────

/**
 * A downstream Stellar network dependency (Horizon or Soroban RPC) could not
 * be reached or timed out. Distinct from a "real zero" result — callers must
 * never substitute an empty/default value for this and should surface it.
 */
export class UpstreamServiceException extends ServiceUnavailableException {
  constructor(message: string) {
    super({ message, error: 'Service Unavailable' });
  }
}

// ── LP mint/burn (status varies by code) ────────────────────────────────────

const STATUS_ERROR_LABELS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

/**
 * A rejected LP mint/burn. Carries a stable `code` (a LiquidityErrorCode) so
 * clients can branch without parsing messages; `applied` is present when the
 * outcome of the request is known not to have changed state (e.g. a replay).
 * Build it through `toLiquidityHttpException` in pools/liquidity-error.map.ts
 * rather than directly, so the status always matches the code.
 */
export class LiquidityOperationException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    correlationId?: string,
    applied?: boolean,
  ) {
    super(
      {
        message,
        error: STATUS_ERROR_LABELS[status] ?? 'Error',
        code,
        ...(correlationId ? { correlationId } : {}),
        ...(applied !== undefined ? { applied } : {}),
      },
      status,
    );
  }
}
