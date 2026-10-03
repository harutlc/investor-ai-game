import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts a well-formed client `X-Request-Id`, otherwise generates one, and echoes it in the response. */
export class RequestIdMiddleware {
  static readonly HEADER = 'X-Request-Id';

  readonly handle = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.get(RequestIdMiddleware.HEADER);
    req.requestId = incoming && UUID.test(incoming) ? incoming.toLowerCase() : randomUUID();
    res.setHeader(RequestIdMiddleware.HEADER, req.requestId);
    next();
  };
}
