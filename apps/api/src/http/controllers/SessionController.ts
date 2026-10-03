import type { SessionDto } from '@inverstorm/shared';
import { Router, type Request, type Response } from 'express';
import type { Controller } from './Controller.js';

/** `GET /api/session`: the current anonymous player's public data. */
export class SessionController implements Controller {
  readonly basePath = '/session';

  routes(): Router {
    return Router().get('/', this.get);
  }

  private readonly get = (req: Request, res: Response): void => {
    if (!req.player) throw new Error('SessionController requires PlayerSessionMiddleware');
    const body: SessionDto = { playerId: req.player.id, createdAt: req.player.createdAt.toISOString() };
    res.set('Cache-Control', 'no-store').json(body);
  };
}
