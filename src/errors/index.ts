/**
 * Standardized Error Classes
 *
 * All application errors should use these classes for consistent
 * error handling, logging, and API responses.
 */

/**
 * Error codes for programmatic handling
 */
export enum ErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',

  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  // Business logic errors
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
}

/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    public isOperational = true,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * 400 Bad Request - Invalid request syntax or parameters
 */
export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, ErrorCode.BAD_REQUEST, true, details);
    this.name = 'BadRequestError';
  }
}

/**
 * 400 Validation Error - Request data failed validation
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, ErrorCode.VALIDATION_ERROR, true, details);
    this.name = 'ValidationError';
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `${resource} with ID '${identifier}' not found`
      : `${resource} not found`;
    super(404, message, ErrorCode.NOT_FOUND, true);
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict - Resource conflict (e.g., duplicate)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, message, ErrorCode.CONFLICT, true, details);
    this.name = 'ConflictError';
  }
}

/**
 * 422 Unprocessable Entity - Valid syntax but cannot process
 */
export class UnprocessableEntityError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, message, ErrorCode.UNPROCESSABLE_ENTITY, true, details);
    this.name = 'UnprocessableEntityError';
  }
}

/**
 * 500 Database Error - Database operation failed
 */
export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, message, ErrorCode.DATABASE_ERROR, false, details);
    this.name = 'DatabaseError';
  }
}

/**
 * 500 External Service Error - Third-party service failed
 */
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(500, `${service}: ${message}`, ErrorCode.EXTERNAL_SERVICE_ERROR, false, details);
    this.name = 'ExternalServiceError';
  }
}

/**
 * 400 Business Rule Violation - Business logic constraint violated
 */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, ErrorCode.BUSINESS_RULE_VIOLATION, true, details);
    this.name = 'BusinessRuleError';
  }
}

/**
 * 400 Insufficient Data - Required data missing or incomplete
 */
export class InsufficientDataError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, ErrorCode.INSUFFICIENT_DATA, true, details);
    this.name = 'InsufficientDataError';
  }
}

/**
 * 500 Processing Error - Background processing failed
 */
export class ProcessingError extends AppError {
  constructor(message: string, details?: unknown) {
    super(500, message, ErrorCode.PROCESSING_ERROR, false, details);
    this.name = 'ProcessingError';
  }
}
