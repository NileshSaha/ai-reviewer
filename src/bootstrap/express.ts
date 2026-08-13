import express, { Express, Request, Response, NextFunction } from 'express';
import { Logger } from '../shared/types/logger';
import { AppError } from '../shared/types/errors';

export function createExpressApp(logger: Logger): Express {
  const app = express();

  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`HTTP ${req.method} ${req.path}`, {
      module: 'express',
      method: req.method,
      path: req.path,
    });
    next();
  });

  return app;
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  console.error('Unhandled error:', err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
