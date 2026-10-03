import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../../errors/NotFoundError.js';

export class NotFoundMiddleware {
  readonly handle = (_req: Request, _res: Response, next: NextFunction): void => {
    next(new NotFoundError('Route not found'));
  };
}
