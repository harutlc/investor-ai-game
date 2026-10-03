import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { RateLimiters } from '../../src/http/middleware/RateLimiters.js';
import { miniApp } from '../support/miniApp.js';

const router = Router()
  .get('/api/health', (_req, res) => res.json({ ok: true }))
  .get('/api/thing', (_req, res) => res.json({ ok: true }))
  .post('/api/thing', (_req, res) => res.json({ ok: true }));

function app(limits: { max: number; mutationMax: number }, trustProxy: false | number = false) {
  const limiters = new RateLimiters({ windowMs: 60_000, ...limits }, ['/api/health']);
  return miniApp(router, { before: [limiters.global(), limiters.mutations()], trustProxy });
}

describe('RateLimiters', () => {
  it('returns 429 RATE_LIMITED with RateLimit headers once the limit is exceeded', async () => {
    const server = app({ max: 2, mutationMax: 100 });
    expect((await request(server).get('/api/thing')).status).toBe(200);
    const second = await request(server).get('/api/thing');
    expect(second.headers['ratelimit']).toMatch(/limit=2, remaining=0/);
    expect(second.headers['ratelimit-policy']).toBeDefined();
    const third = await request(server).get('/api/thing');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('exempts the health endpoint from the global limit', async () => {
    const server = app({ max: 1, mutationMax: 100 });
    for (let i = 0; i < 5; i++) expect((await request(server).get('/api/health')).status).toBe(200);
  });

  it('applies the stricter mutation limit to non-safe methods only', async () => {
    const server = app({ max: 100, mutationMax: 1 });
    expect((await request(server).post('/api/thing').send({})).status).toBe(200);
    expect((await request(server).post('/api/thing').send({})).status).toBe(429);
    expect((await request(server).get('/api/thing')).status).toBe(200);
  });

  it('ignores a spoofed X-Forwarded-For when trust proxy is off', async () => {
    const server = app({ max: 1, mutationMax: 100 });
    expect((await request(server).get('/api/thing').set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    // A different spoofed address must not buy a fresh quota: the key is still the socket address.
    expect((await request(server).get('/api/thing').set('X-Forwarded-For', '2.2.2.2')).status).toBe(429);
  });

  it('keys on X-Forwarded-For when one proxy hop is trusted', async () => {
    const server = app({ max: 1, mutationMax: 100 }, 1);
    expect((await request(server).get('/api/thing').set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    expect((await request(server).get('/api/thing').set('X-Forwarded-For', '2.2.2.2')).status).toBe(200);
  });
});
