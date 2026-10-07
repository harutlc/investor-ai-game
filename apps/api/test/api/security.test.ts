import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN } from '../support/testConfig.js';
import { createTestApp } from '../support/createTestApp.js';

describe('security baseline on the real app', () => {
  it.each(['/api/health', '/api/session', '/api/nope'])('%s carries hardened headers', async (path) => {
    const { app } = await createTestApp();
    const res = await request(app).get(path);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('sends HSTS only in production', async () => {
    expect(
      (await request((await createTestApp()).app).get('/api/health')).headers['strict-transport-security'],
    ).toBe(undefined);
    const prod = await createTestApp({ nodeEnv: 'production' });
    expect((await request(prod.app).get('/api/health')).headers['strict-transport-security']).toBeDefined();
  });

  it('allows the configured origin with credentials and ignores others', async () => {
    const { app } = await createTestApp();
    const ok = await request(app).get('/api/health').set('Origin', ALLOWED_ORIGIN);
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a mutating request without a CSRF token', async () => {
    const { app } = await createTestApp();
    const res = await request(app).post('/api/session').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects oversized JSON with 413', async () => {
    const { app } = await createTestApp();
    const res = await request(app)
      .post('/api/session')
      .send({ blob: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
