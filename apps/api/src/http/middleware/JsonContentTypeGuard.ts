import type { NextFunction, Request, Response } from 'express';
import { UnsupportedMediaTypeError } from '../../errors/UnsupportedMediaTypeError.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Only `application/json` bodies are accepted on POST/PUT/PATCH. This rejects HTML form posts (a classic
 * CSRF vector) before any parsing happens. Requests without a body pass.
 */
export class JsonContentTypeGuard {
  readonly handle = (req: Request, _res: Response, next: NextFunction): void => {
    if (BODY_METHODS.has(req.method) && JsonContentTypeGuard.hasBody(req) && !req.is('application/json')) {
      next(new UnsupportedMediaTypeError());
      return;
    }
    next();
  };

  private static hasBody(req: Request): boolean {
    const length = req.headers['content-length'];
    return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
  }
}
