import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { AppError, ErrorCode } from '../errors';

/**
 * Standardized error response format.
 * All errors include requestId for tracing and code for programmatic handling.
 */
export interface ErrorResponse {
  error: string;
  message: string;
  code: ErrorCode;
  statusCode: number;
  requestId: string;
  details?: unknown;
}

/**
 * Maps Prisma error codes to user-friendly messages
 */
function getPrismaErrorMessage(code: string): { message: string; statusCode: number } {
  switch (code) {
    case 'P2002':
      return { message: 'A record with this value already exists', statusCode: 409 };
    case 'P2025':
      return { message: 'Record not found', statusCode: 404 };
    case 'P2003':
      return { message: 'Related record not found', statusCode: 400 };
    case 'P2014':
      return { message: 'Invalid relation data', statusCode: 400 };
    default:
      return { message: 'A database error occurred', statusCode: 500 };
  }
}

/**
 * Central error handler middleware
 * Catches all errors and returns standardized responses
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = req.requestId || 'unknown';

  // Log error with full context
  logger.error('Error:', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Handle AppError and subclasses
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      error: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      requestId,
      details: err.details,
    };
    return res.status(err.statusCode).json(response);
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as Error & { code?: string };
    const { message, statusCode } = getPrismaErrorMessage(prismaError.code || '');
    const response: ErrorResponse = {
      error: 'DatabaseError',
      message,
      code: ErrorCode.DATABASE_ERROR,
      statusCode,
      requestId,
    };
    return res.status(statusCode).json(response);
  }

  // Handle Prisma validation errors
  if (err.name === 'PrismaClientValidationError') {
    const response: ErrorResponse = {
      error: 'ValidationError',
      message: 'Invalid data provided',
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: 400,
      requestId,
    };
    return res.status(400).json(response);
  }

  // Handle SyntaxError (e.g., invalid JSON)
  if (err instanceof SyntaxError && 'body' in err) {
    const response: ErrorResponse = {
      error: 'BadRequest',
      message: 'Invalid JSON in request body',
      code: ErrorCode.BAD_REQUEST,
      statusCode: 400,
      requestId,
    };
    return res.status(400).json(response);
  }

  // Default error response (unknown errors)
  const response: ErrorResponse = {
    error: 'InternalError',
    message: 'An unexpected error occurred',
    code: ErrorCode.INTERNAL_ERROR,
    statusCode: 500,
    requestId,
  };
  return res.status(500).json(response);
};

/**
 * 404 handler for unmatched routes
 */
export const notFoundHandler = (req: Request, res: Response) => {
  const requestId = req.requestId || 'unknown';
  const response: ErrorResponse = {
    error: 'NotFound',
    message: `Route ${req.method} ${req.path} not found`,
    code: ErrorCode.NOT_FOUND,
    statusCode: 404,
    requestId,
  };
  res.status(404).json(response);
};

// Re-export AppError for backward compatibility
export { AppError } from '../errors';
