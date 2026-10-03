import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SecurityHeaders } from '../../src/http/middleware/SecurityHeaders.js';
import { miniApp } from '../support/miniApp.js';

const router = Router().get('/ping', (_req, res) => res.json({ ok: true }));
const app = (isProduction: boolean) => miniApp(router, { before: [SecurityHeaders.create(isProduction)] });

describe('SecurityHeaders', () => {
  it('sends hardened headers and no X-Powered-By', async () => {
    const res = await request(app(false)).get('/ping');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('applies to error responses too', async () => {
    const res = await request(app(false)).get('/missing');
    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('omits HSTS outside production', async () => {
    const res = await request(app(false)).get('/ping');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sends HSTS in production', async () => {
    const res = await request(app(true)).get('/ping');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});
