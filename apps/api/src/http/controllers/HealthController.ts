import { Router, type Request, type Response } from 'express';
import type { HealthService } from '../../services/HealthService.js';
import type { Controller } from './Controller.js';

/** `GET /api/health`: mounted before cookies and sessions, so probes never create players. */
export class HealthController implements Controller {
  readonly basePath = '/health';

  constructor(private readonly health: HealthService) {}

  routes(): Router {
    return Router().get('/', this.get);
  }

  private readonly get = async (_req: Request, res: Response): Promise<void> => {
    const result = await this.health.check();
    res
      .status(result.status === 'ok' ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(result);
  };
}
