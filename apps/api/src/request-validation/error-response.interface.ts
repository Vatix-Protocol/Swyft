export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

export interface ValidationErrorResponse extends ErrorResponse {
  validationErrors: ValidationFieldError[];
}

export interface ValidationFieldError {
  field: string;
  constraints: string[];
}
