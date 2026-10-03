import type { PersonaListDto } from '@investor/shared';
import { Router, type Request, type Response } from 'express';
import type { PersonaCatalog } from '../../personas/PersonaCatalog.js';
import type { Controller } from './Controller.js';

/** `GET /api/personas`: the investors a player can pick, public profiles only. */
export class PersonaController implements Controller {
  readonly basePath = '/personas';
  private readonly body: PersonaListDto;

  constructor(catalog: PersonaCatalog) {
    // The catalog is fixed for the life of the process, so the response is built once.
    this.body = { personas: catalog.list().map((persona) => persona.toPublicDto()) };
  }

  routes(): Router {
    return Router().get('/', this.list);
  }

  private readonly list = (_req: Request, res: Response): void => {
    res.set('Cache-Control', 'private, max-age=300').json(this.body);
  };
}
