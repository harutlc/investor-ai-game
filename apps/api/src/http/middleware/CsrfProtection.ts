import { doubleCsrf } from 'csrf-csrf';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../../config/AppConfig.js';
import { CsrfError } from '../../errors/CsrfError.js';

/**
 * Signed double-submit CSRF tokens, HMAC-bound to the player session: a token minted for one player
 * is useless with another player's cookies. GET/HEAD/OPTIONS are exempt, so they must never change state.
 */
export class CsrfProtection {
  static readonly HEADER = 'x-csrf-token';
  readonly cookieName: string;
  private readonly utilities: ReturnType<typeof doubleCsrf>;

  constructor(config: AppConfig) {
    this.cookieName = config.isProduction ? '__Host-inv.csrf' : 'inv.csrf';
    this.utilities = doubleCsrf({
      getSecret: () => config.secrets.csrfSecret,
      getSessionIdentifier: (req) => req.player?.id ?? '',
      cookieName: this.cookieName,
      cookieOptions: { httpOnly: true, sameSite: 'lax', path: '/', secure: config.isProduction },
      ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
      getCsrfTokenFromRequest: (req) => req.get(CsrfProtection.HEADER),
    });
  }

  /** Rejects state-changing requests without a valid token as 403 CSRF_INVALID. */
  readonly handle = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.player) {
      next(new Error('CsrfProtection must be mounted after PlayerSessionMiddleware'));
      return;
    }
    this.utilities.doubleCsrfProtection(req, res, (error?: unknown) => {
      next(error === this.utilities.invalidCsrfTokenError ? new CsrfError() : error);
    });
  };

  /** Returns the session's token (reusing a still-valid one) and sets the matching cookie. */
  issueToken(req: Request, res: Response): string {
    return this.utilities.generateCsrfToken(req, res);
  }
}
