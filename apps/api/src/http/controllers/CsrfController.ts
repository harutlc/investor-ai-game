import type { CsrfTokenDto } from '@investor/shared';
import { Router, type Request, type Response } from 'express';
import type { CsrfProtection } from '../middleware/CsrfProtection.js';
import type { Controller } from './Controller.js';

/** `GET /api/csrf-token`: returns the token to send as `X-CSRF-Token` and sets its cookie. */
export class CsrfController implements Controller {
  readonly basePath = '/csrf-token';

  constructor(private readonly csrf: CsrfProtection) {}

  routes(): Router {
    return Router().get('/', this.get);
  }

  private readonly get = (req: Request, res: Response): void => {
    const body: CsrfTokenDto = { csrfToken: this.csrf.issueToken(req, res) };
    res.set('Cache-Control', 'no-store').json(body);
  };
}
