import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../../config/AppConfig.js';
import type { PlayerService } from '../../services/PlayerService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Gives every request an anonymous player. The id lives in a cookie signed by cookie-parser, so clients
 * cannot choose or forge it; a missing, tampered or unknown id yields a brand-new player.
 */
export class PlayerSessionMiddleware {
  readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    config: AppConfig,
    private readonly players: PlayerService,
  ) {
    // `__Host-` makes the browser require Secure, Path=/ and no Domain: the cookie cannot be set by subdomains.
    this.cookieName = config.isProduction ? '__Host-inv.pid' : 'inv.pid';
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: config.isProduction,
      signed: true,
      maxAge: config.security.sessionMaxAgeDays * DAY_MS,
    };
  }

  readonly handle = (req: Request, res: Response, next: NextFunction): void => {
    // cookie-parser puts verified values in signedCookies and `false` for a bad signature.
    const signed: unknown = (req.signedCookies as Record<string, unknown>)[this.cookieName];
    const { player, issueCookie } = this.players.resolveOrCreate(
      typeof signed === 'string' ? signed : undefined,
    );
    req.player = player;
    if (issueCookie) res.cookie(this.cookieName, player.id, this.cookieOptions);
    next();
  };
}
