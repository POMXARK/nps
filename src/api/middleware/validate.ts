import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'params' | 'query' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({
        error: 'validation_error',
        details: formatZodErrors(result.error),
      });
      return;
    }
    req[source] = result.data;
    next();
  };
}

function formatZodErrors(err: ZodError): Record<string, string> {
  return Object.fromEntries(
    err.errors.map((e) => [e.path.join('.'), e.message]),
  );
}
