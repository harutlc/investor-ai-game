import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { miniApp } from '../support/miniApp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const app = miniApp(Router().get('/echo', (req, res) => res.json({ id: req.requestId })));

describe('RequestIdMiddleware', () => {
  it('generates a UUID when none is supplied', async () => {
    const res = await request(app).get('/echo');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body).toEqual({ id: res.headers['x-request-id'] });
  });

  it('accepts a well-formed client UUID', async () => {
    const id = '0b6f6a52-3f0e-4b8c-9d61-7a1f2e3d4c5b';
    const res = await request(app).get('/echo').set('X-Request-Id', id);
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('replaces a malicious value with a generated UUID', async () => {
    const res = await request(app).get('/echo').set('X-Request-Id', '<script>');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('includes the request id in error responses', async () => {
    const res = await request(app).get('/missing');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });
});
