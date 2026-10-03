import { ApiErrorSchema } from '@inverstorm/shared';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { miniApp } from '../support/miniApp.js';

const router = Router()
  .get('/boom', () => {
    throw new Error('secret detail');
  })
  .get('/async-boom', async () => {
    await Promise.resolve();
    throw new Error('async secret');
  })
  .post('/echo', (req, res) => res.json(req.body));

describe('ErrorHandlerMiddleware', () => {
  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await request(miniApp(router)).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns 400 INVALID_JSON for a malformed body', async () => {
    const res = await request(miniApp(router))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for an oversized body', async () => {
    const res = await request(miniApp(router))
      .post('/echo')
      .send({ blob: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides unexpected error messages and stacks in production', async () => {
    const app = miniApp(router, { isProduction: true });
    for (const path of ['/boom', '/async-boom']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(500);
      const body = ApiErrorSchema.parse(res.body);
      expect(body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: res.headers['x-request-id'],
      });
      expect(res.text).not.toContain('secret');
      expect(res.text).not.toContain('at ');
    }
  });

  it('shows the message (never the stack) outside production', async () => {
    const res = await request(miniApp(router)).get('/boom');
    expect(res.body.error.message).toBe('secret detail');
    expect(res.text).not.toContain('ErrorHandlerMiddleware.test');
  });
});
