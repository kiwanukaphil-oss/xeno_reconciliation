import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// AsyncLocalStorage to maintain request context across async operations
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

// Extend Express Request type to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Middleware to generate and attach a unique request ID to each request.
 *
 * Features:
 * - Generates a UUID v4 for each request
 * - Attaches it to req.requestId for route handlers
 * - Sets X-Request-ID response header for client-side correlation
 * - Uses AsyncLocalStorage for access in async contexts (services, repositories)
 *
 * Usage in route handlers:
 *   const requestId = req.requestId;
 *
 * Usage in services (via context):
 *   import { getRequestId } from '../middleware/requestId';
 *   const requestId = getRequestId();
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Accept client-provided request ID or generate new one
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();

  // Attach to request object
  req.requestId = requestId;

  // Set response header for client correlation
  res.setHeader('X-Request-ID', requestId);

  // Run the rest of the request in context for async access
  requestContext.run({ requestId }, () => {
    next();
  });
};

/**
 * Get the current request ID from async context.
 * Safe to call from services, repositories, etc.
 * Returns 'no-context' if called outside a request context.
 */
export function getRequestId(): string {
  const context = requestContext.getStore();
  return context?.requestId || 'no-context';
}
