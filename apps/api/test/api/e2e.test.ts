import { CsrfTokenDtoSchema, SessionDtoSchema } from '@investor/shared';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Controller } from '../../src/http/controllers/Controller.js';
import { ValidationMiddleware } from '../../src/http/middleware/ValidationMiddleware.js';
import { ALLOWED_ORIGIN } from '../support/testConfig.js';
import { createTestApp } from '../support/createTestApp.js';

/** Stands in for future mutating endpoints (e.g. POST /api/games). */
class EchoController implements Controller {
  readonly basePath = '/echo';
  private readonly schemas = { body: z.object({ message: z.string().min(1) }) };

  routes(): Router {
    return Router().post('/', ValidationMiddleware.validate(this.schemas), (req, res) => {
      const { body } = ValidationMiddleware.validated(res, this.schemas);
      res.status(201).json({ playerId: req.player?.id, message: body.message });
    });
  }
}

describe('browser flow: session → CSRF token → mutation', () => {
  it('works end to end with cookies and the token, and fails without the token', async () => {
    const { app } = await createTestApp({ extraControllers: [new EchoController()] });
    const browser = request.agent(app);

    const session = SessionDtoSchema.parse(
      (await browser.get('/api/session').set('Origin', ALLOWED_ORIGIN)).body,
    );
    const { csrfToken } = CsrfTokenDtoSchema.parse((await browser.get('/api/csrf-token')).body);

    const ok = await browser
      .post('/api/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .set('X-CSRF-Token', csrfToken)
      .send({ message: 'hello' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ playerId: session.playerId, message: 'hello' });
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    const forged = await browser.post('/api/echo').set('Origin', ALLOWED_ORIGIN).send({ message: 'hello' });
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe('CSRF_INVALID');

    const invalid = await browser.post('/api/echo').set('X-CSRF-Token', csrfToken).send({ message: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});
