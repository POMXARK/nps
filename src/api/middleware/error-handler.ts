import { Request, Response, NextFunction } from 'express';
import { logger } from '../../infrastructure/logger';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error('unhandled_error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'internal_server_error' });
}
