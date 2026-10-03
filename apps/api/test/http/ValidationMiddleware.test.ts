import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationMiddleware } from '../../src/http/middleware/ValidationMiddleware.js';
import { miniApp } from '../support/miniApp.js';

const schemas = {
  params: z.object({ id: z.uuid() }),
  query: z.object({ verbose: z.enum(['true', 'false']).optional() }),
  body: z.object({ name: z.string().min(1), amount: z.number().int() }),
};
const router = Router().post('/items/:id', ValidationMiddleware.validate(schemas), (_req, res) => {
  const { params, body, query } = ValidationMiddleware.validated(res, schemas);
  res.json({ id: params.id, name: body.name, amount: body.amount, verbose: query.verbose ?? null });
});
const app = miniApp(router);
const ID = '0b6f6a52-3f0e-4b8c-9d61-7a1f2e3d4c5b';

describe('ValidationMiddleware', () => {
  it('passes parsed values to the handler', async () => {
    const res = await request(app).post(`/items/${ID}?verbose=true`).send({ name: 'x', amount: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: ID, name: 'x', amount: 5, verbose: 'true' });
  });

  it('rejects a missing field with its path', async () => {
    const res = await request(app).post(`/items/${ID}`).send({ amount: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'body.name' })]);
  });

  it('rejects unknown fields', async () => {
    const res = await request(app).post(`/items/${ID}`).send({ name: 'x', amount: 5, isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'body.isAdmin' })]);
  });

  it('reports params, query and body issues together', async () => {
    const res = await request(app).post('/items/not-a-uuid?verbose=maybe').send({ name: '', amount: 1.5 });
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['body.amount', 'body.name', 'params.id', 'query.verbose']);
  });
});
