import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN } from '../support/testConfig.js';
import { createTestApp } from '../support/createTestApp.js';

describe('ApiServer middleware order', () => {
  it('serves health before the session layer (no player row)', async () => {
    const { app, players } = await createTestApp();
    await request(app).get('/api/health');
    expect(await players.count()).toBe(0);
  });

  it('answers CORS preflights before the session layer', async () => {
    const { app, players } = await createTestApp();
    for (const origin of [ALLOWED_ORIGIN, 'https://evil.example']) {
      await request(app)
        .options('/api/session')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
    }
    expect(await players.count()).toBe(0);
  });

  it('rejects rate-limited requests before touching the database', async () => {
    const { app, players } = await createTestApp({ rateLimit: { max: 1 } });
    await request(app).get('/api/session');
    expect(await players.count()).toBe(1);
    const limited = await request(app).get('/api/session');
    expect(limited.status).toBe(429);
    expect(await players.count()).toBe(1);
  });

  it('rejects non-JSON bodies before parsing (415 beats CSRF 403)', async () => {
    const { app } = await createTestApp();
    const res = await request(app).post('/api/session').type('form').send('a=1');
    expect(res.status).toBe(415);
  });

  it('applies the configured trust proxy setting', async () => {
    const { app } = await createTestApp({ server: { trustProxy: 1 } });
    expect(app.get('trust proxy')).toBe(1);
  });
});
