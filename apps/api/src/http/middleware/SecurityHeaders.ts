import type { RequestHandler } from 'express';
import helmet from 'helmet';

const ONE_YEAR_SECONDS = 31_536_000;

/** Helmet tuned for a JSON API: nothing may be framed, loaded or embedded from responses. */
export class SecurityHeaders {
  static create(isProduction: boolean): RequestHandler {
    return helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      xFrameOptions: { action: 'deny' },
      // HSTS only makes sense behind HTTPS; sending it on http://localhost would pin the dev browser.
      strictTransportSecurity: isProduction ? { maxAge: ONE_YEAR_SECONDS, includeSubDomains: true } : false,
    });
  }
}
