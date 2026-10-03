import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/AppConfig.js';
import { RateLimitError } from '../../errors/RateLimitError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Per-IP limits (in-memory store: single instance only). Keys on `req.ip`, which honours `trust proxy`. */
export class RateLimiters {
  constructor(
    private readonly limits: AppConfig['security']['rateLimit'],
    private readonly exemptPaths: readonly string[] = [],
  ) {}

  /** Every request except exempt paths (e.g. health probes). */
  global(): RequestHandler {
    return rateLimit({
      windowMs: this.limits.windowMs,
      limit: this.limits.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => this.exemptPaths.includes(req.path),
      handler: this.reject,
    });
  }

  /** Stricter limit for state-changing requests. */
  mutations(): RequestHandler {
    return rateLimit({
      windowMs: this.limits.windowMs,
      limit: this.limits.mutationMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => SAFE_METHODS.has(req.method),
      handler: this.reject,
    });
  }

  private readonly reject = (_req: Request, _res: Response, next: NextFunction): void => {
    next(new RateLimitError());
  };
}
