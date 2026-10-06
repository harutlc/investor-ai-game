import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../../logging/RequestContext.js';

/**
 * Runs the rest of the request inside a RequestContext, so every log line it causes carries the request id,
 * and tags the request's Sentry scope with it. Mounted right after RequestIdMiddleware.
 */
export class RequestContextMiddleware {
  readonly handle = (req: Request, _res: Response, next: NextFunction): void => {
    Sentry.getIsolationScope().setTag('request_id', req.requestId);
    RequestContext.run({ requestId: req.requestId }, next);
  };
}
