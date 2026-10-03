import { HealthDtoSchema } from '@inverstorm/shared';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { createTestApp } from '../support/createTestApp.js';

describe('GET /api/health', () => {
  it('returns 200 ok when the database answers', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    const body = HealthDtoSchema.parse(res.body);
    expect(body).toMatchObject({ status: 'ok', checks: { database: 'ok', thinking: 'ok', decision: 'ok' } });
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

  it('stays 200 when a provider is down, reporting it in checks', async () => {
    const thinkingProvider = new FakeThinkingProvider().setHealthy(false);
    const { app } = createTestApp({ thinkingProvider });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', thinking: 'error', decision: 'ok' },
    });
  });

  it('pings providers once per cache period', async () => {
    const decisionProvider = new FakeDecisionProvider();
    const ping = vi.spyOn(decisionProvider, 'ping');
    const { app } = createTestApp({ decisionProvider });
    await request(app).get('/api/health');
    await request(app).get('/api/health');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('never names providers, models or URLs', async () => {
    const { app } = createTestApp({
      mutate: (config) => {
        config.llm.thinking.provider = 'ollama';
        config.llm.decision.provider = 'laya';
      },
    });
    const res = await request(app).get('/api/health');
    expect(res.text).not.toMatch(/ollama|laya|llama|english|http/i);
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
