import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

// ── 400 ─────────────────────────────────────────────────────────────────────

export class InvalidInputException extends BadRequestException {
  constructor(message: string) {
    super({ message, error: 'Bad Request' });
  }
}

// ── 401 ─────────────────────────────────────────────────────────────────────

export class MissingTokenException extends UnauthorizedException {
  constructor() {
    super({ message: 'Authentication token is missing', error: 'Unauthorized' });
  }
}

export class InvalidTokenException extends UnauthorizedException {
  constructor() {
    super({ message: 'Authentication token is invalid or expired', error: 'Unauthorized' });
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
