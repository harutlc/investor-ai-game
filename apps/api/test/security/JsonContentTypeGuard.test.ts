import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { miniApp } from '../support/miniApp.js';

const app = miniApp(Router().post('/echo', (req, res) => res.json({ body: (req.body as unknown) ?? null })));

describe('JsonContentTypeGuard + body limit', () => {
  it('rejects a form post with 415', async () => {
    const res = await request(app).post('/echo').type('form').send('a=1');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects text/plain (a CORS "simple request" type) with 415', async () => {
    const res = await request(app).post('/echo').set('Content-Type', 'text/plain').send('{"a":1}');
    expect(res.status).toBe(415);
  });

  it('accepts JSON with a charset', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send('{"a":1}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { a: 1 } });
  });

  it('lets an empty-body POST through', async () => {
    const res = await request(app).post('/echo');
    expect(res.status).toBe(200);
  });

  it('rejects a 200 KB JSON body with 413', async () => {
    const res = await request(app)
      .post('/echo')
      .send({ blob: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
