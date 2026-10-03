import { CsrfTokenDtoSchema, SessionDtoSchema } from '@inverstorm/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/createTestApp.js';

describe('GET /api/session', () => {
  it('issues an anonymous player and returns only public fields', async () => {
    const { app, players } = createTestApp();
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(200);
    const body = SessionDtoSchema.parse(res.body);
    expect(players.findById(body.playerId)).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps the same player across requests', async () => {
    const { app, players } = createTestApp();
    const agent = request.agent(app);
    const first = await agent.get('/api/session');
    const second = await agent.get('/api/session');
    expect(second.body).toEqual(first.body);
    expect(players.count()).toBe(1);
  });

  it('uses a 30-day cookie by default', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/session');
    expect(String(res.headers['set-cookie'])).toMatch(/inv\.pid=.*Max-Age=2592000/);
  });

  it('issues a new player when the stored player no longer exists', async () => {
    const { app, container } = createTestApp();
    const agent = request.agent(app);
    const first = (await agent.get('/api/session')).body as { playerId: string };
    container.database.sqlite.prepare('delete from players').run();
    const second = await agent.get('/api/session');
    expect(second.body.playerId).not.toBe(first.playerId);
    expect(String(second.headers['set-cookie'])).toContain('inv.pid=');
  });
});

describe('GET /api/csrf-token', () => {
  it('returns a token and sets the CSRF cookie', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(CsrfTokenDtoSchema.parse(res.body).csrfToken.length).toBeGreaterThan(32);
    expect(String(res.headers['set-cookie'])).toContain('inv.csrf=');
  });
});
