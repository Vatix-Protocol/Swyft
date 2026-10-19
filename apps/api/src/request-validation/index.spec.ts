/**
 * Exercises the public validation barrel (`apps/api/src/request-validation/index.ts`)
 * so a change to its exports (or a missing export that a consumer would have
 * silently dropped) is caught. Run: pnpm --filter api test.
 *
 * Types (`ErrorResponse`, `ValidationErrorResponse`, `ValidationFieldError`)
 * are imported via `import type` because they are type-only; every *value*
 * export is asserted at runtime instead.
 */
import type { ErrorResponse, ValidationErrorResponse, ValidationFieldError } from './index';
import {
  CommonModule,
  AllExceptionsFilter,
  PaginationQueryDto,
  PaginatedResponseDto,
  SortOrder,
  UuidParamDto,
  InvalidInputException,
  MissingTokenException,
  InvalidTokenException,
  InsufficientPermissionsException,
  ResourceNotFoundException,
  DuplicateResourceException,
  BusinessRuleViolationException,
  SlippageExceededException,
  UpstreamServiceException,
  LiquidityOperationException,
} from './index';

describe('request-validation index barrel (issue #1227)', () => {
  it('exports every symbol and none is undefined', () => {
    expect(CommonModule).toBeDefined();
    expect(AllExceptionsFilter).toBeDefined();
    expect(PaginationQueryDto).toBeDefined();
    expect(PaginatedResponseDto).toBeDefined();
    expect(SortOrder).toBeDefined();
    expect(UuidParamDto).toBeDefined();
    expect(InvalidInputException).toBeDefined();
    expect(MissingTokenException).toBeDefined();
    expect(InvalidTokenException).toBeDefined();
    expect(InsufficientPermissionsException).toBeDefined();
    expect(ResourceNotFoundException).toBeDefined();
    expect(DuplicateResourceException).toBeDefined();
    expect(BusinessRuleViolationException).toBeDefined();
    expect(SlippageExceededException).toBeDefined();
    expect(UpstreamServiceException).toBeDefined();
    expect(LiquidityOperationException).toBeDefined();
  });
});
