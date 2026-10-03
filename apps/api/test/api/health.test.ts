import { HealthDtoSchema } from '@inverstorm/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/createTestApp.js';

describe('GET /api/health', () => {
  it('returns 200 ok when the database answers', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    const body = HealthDtoSchema.parse(res.body);
    expect(body).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 degraded when the database is unavailable', async () => {
    const { app, container } = createTestApp();
    container.database.close();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(HealthDtoSchema.parse(res.body)).toMatchObject({
      status: 'degraded',
      checks: { database: 'error' },
    });
  });

  it('sets no cookies and creates no player', async () => {
    const { app, players } = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(players.count()).toBe(0);
  });

  it('reveals nothing beyond status, uptime and checks', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/health');
    expect(Object.keys(res.body as object).sort()).toEqual(['checks', 'status', 'uptime']);
  });
});
