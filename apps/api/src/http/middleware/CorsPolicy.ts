import cors from 'cors';
import type { RequestHandler } from 'express';

/** Exact-match origin allowlist with credentials. Disallowed origins get no CORS headers at all. */
export class CorsPolicy {
  static readonly METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  static readonly ALLOWED_HEADERS = ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'];
  static readonly EXPOSED_HEADERS = ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'];

  /**
   * The CORS handler, followed by a terminator for preflights from disallowed origins: `cors` lets those
   * fall through, and they must never reach the session layer (which would create a player row).
   */
  static create(origins: readonly string[]): RequestHandler[] {
    const allowed = new Set(origins);
    const handler = cors({
      origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
      credentials: true,
      methods: CorsPolicy.METHODS,
      allowedHeaders: CorsPolicy.ALLOWED_HEADERS,
      exposedHeaders: CorsPolicy.EXPOSED_HEADERS,
      maxAge: 600,
    });
    const endPreflight: RequestHandler = (req, res, next) => {
      if (req.method === 'OPTIONS') res.sendStatus(204);
      else next();
    };
    return [handler, endPreflight];
  }
}
