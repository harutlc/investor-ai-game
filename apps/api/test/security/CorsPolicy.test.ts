import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CorsPolicy } from '../../src/http/middleware/CorsPolicy.js';
import { miniApp } from '../support/miniApp.js';

const ALLOWED = 'http://localhost:5173';
const app = miniApp(
  Router().get('/ping', (_req, res) => res.json({ ok: true })),
  { before: CorsPolicy.create([ALLOWED]) },
);

describe('CorsPolicy', () => {
  it('answers an allowed preflight with credentials', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type,X-CSRF-Token,X-Request-Id');
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('sends no CORS headers to a disallowed origin', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('ends a preflight from a disallowed origin without CORS headers', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('does not reflect a lookalike origin', async () => {
    const res = await request(app).get('/ping').set('Origin', 'http://localhost:5173.evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes the request id to the browser', async () => {
    const res = await request(app).get('/ping').set('Origin', ALLOWED);
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });
});
