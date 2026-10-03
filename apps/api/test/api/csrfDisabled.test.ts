import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { createTestApp } from '../support/createTestApp.js';

const conversation = { messages: [{ role: 'user', content: 'Pitch me' }] };

describe('security.csrf.enabled = false', () => {
  it('does not mount GET /api/csrf-token', async () => {
    const { app } = createTestApp({ csrf: false });
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('accepts state-changing requests without a token', async () => {
    const { app } = createTestApp({ csrf: false, thinkingProvider: new FakeThinkingProvider(['Deal.']) });
    const res = await request.agent(app).post('/api/dev/thinking/text').send(conversation);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Deal.');
  });

  it('issues only the player cookie, no CSRF cookie', async () => {
    const { app } = createTestApp({ csrf: false });
    const cookies = String(
      (await request(app).post('/api/dev/thinking/text').send(conversation)).headers['set-cookie'],
    );
    expect(cookies).toContain('inv.pid=');
    expect(cookies).not.toContain('inv.csrf');
  });

  it('still rejects form posts (JSON-only bodies remain the cross-site guard)', async () => {
    const { app } = createTestApp({ csrf: false });
    const res = await request(app).post('/api/dev/thinking/text').type('form').send('a=1');
    expect(res.status).toBe(415);
  });
});
