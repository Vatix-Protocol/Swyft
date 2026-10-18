export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  requestId?: string;
  /** Machine-readable error code when provided by the throwing exception. */
  code?: string;
  /**
   * Present on LP mint/burn rejections whose state effect is known: `false`
   * means the request changed nothing (e.g. a replayed idempotency key).
   */
  applied?: boolean;
}

export interface ValidationErrorResponse extends ErrorResponse {
  validationErrors: ValidationFieldError[];
}

export interface ValidationFieldError {
  field: string;
  constraints: string[];
}
