import {
  DecisionResultDtoSchema,
  PlaygroundJsonResponseSchema,
  PlaygroundTextResponseSchema,
} from '@inverstorm/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { createTestApp } from '../support/createTestApp.js';

type App = ReturnType<typeof createTestApp>['app'];

/** A browser-like agent with a player session and a CSRF token. */
async function browser(app: App) {
  const agent = request.agent(app);
  const { csrfToken } = (await agent.get('/api/csrf-token')).body as { csrfToken: string };
  return { post: (path: string, body: object) => agent.post(path).set('X-CSRF-Token', csrfToken).send(body) };
}

const conversation = {
  system: 'You are a greedy investor.',
  messages: [{ role: 'user', content: 'Pitch me' }],
};

describe('playground: thinking text', () => {
  it('returns the active provider reply', async () => {
    const { app } = createTestApp({ thinkingProvider: new FakeThinkingProvider(['30% or nothing.']) });
    const res = await (await browser(app)).post('/api/dev/thinking/text', conversation);
    expect(res.status).toBe(200);
    expect(PlaygroundTextResponseSchema.parse(res.body)).toMatchObject({
      provider: 'fake',
      text: '30% or nothing.',
    });
  });

  it('rejects an empty conversation', async () => {
    const { app } = createTestApp();
    const res = await (await browser(app)).post('/api/dev/thinking/text', { messages: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('playground: thinking JSON', () => {
  const schema = {
    type: 'object',
    properties: { options: { type: 'array', items: { type: 'string' } } },
    required: ['options'],
  };

  it('returns data that conforms to the posted schema', async () => {
    const thinkingProvider = new FakeThinkingProvider(['{"options":["Counter at 20%","Walk away"]}']);
    const { app } = createTestApp({ thinkingProvider });
    const res = await (await browser(app)).post('/api/dev/thinking/json', { ...conversation, schema });
    expect(res.status).toBe(200);
    expect(PlaygroundJsonResponseSchema.parse(res.body).data).toEqual({
      options: ['Counter at 20%', 'Walk away'],
    });
  });

  it('enforces the posted schema through the retry path', async () => {
    const thinkingProvider = new FakeThinkingProvider(['{"options":[1]}', '{"options":["ok"]}']);
    const { app } = createTestApp({ thinkingProvider });
    const res = await (await browser(app)).post('/api/dev/thinking/json', { ...conversation, schema });
    expect(res.body.data).toEqual({ options: ['ok'] });
  });

  it('rejects an unusable JSON Schema with 400', async () => {
    const { app } = createTestApp();
    const res = await (
      await browser(app)
    ).post('/api/dev/thinking/json', { ...conversation, schema: { type: 'banana' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('body.schema');
  });

  it('rejects an oversized schema', async () => {
    const properties = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`p${i}`, { type: 'string' }]),
    );
    const { app } = createTestApp();
    const res = await (
      await browser(app)
    ).post('/api/dev/thinking/json', {
      ...conversation,
      schema: { type: 'object', properties },
    });
    expect(res.status).toBe(400);
  });
});

describe('playground: decision', () => {
  it('returns normalized answers from the active decision provider', async () => {
    const decisionProvider = new FakeDecisionProvider([
      { reaction: { type: 'choice', value: 'counter', confidence: 0.8, probabilities: { counter: 0.9 } } },
    ]);
    const { app } = createTestApp({ decisionProvider });
    const res = await (
      await browser(app)
    ).post('/api/dev/decision', {
      state: { player_offer: { investment: 500000, equity: 15 } },
      questions: {
        reaction: {
          type: 'choice',
          instructions: 'How should the investor react?',
          criteria: { accept: null, counter: null, reject: null },
        },
      },
    });
    expect(res.status).toBe(200);
    const body = DecisionResultDtoSchema.parse(res.body);
    expect(body.answers.reaction).toMatchObject({ type: 'choice', value: 'counter' });
  });
});

describe('playground: protections and availability', () => {
  it('requires a CSRF token', async () => {
    const { app } = createTestApp();
    const res = await request(app).post('/api/dev/thinking/text').send(conversation);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('is not mounted when dev.playground is false', async () => {
    const { app } = createTestApp({ playground: false });
    const res = await (await browser(app)).post('/api/dev/decision', {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('is never mounted in production, even when enabled', async () => {
    const { app } = createTestApp({ nodeEnv: 'production', playground: true });
    const agent = request.agent(app);
    // Production cookies are Secure, so the agent cannot replay them over http: send them explicitly.
    const tokenRes = await agent.get('/api/csrf-token');
    const cookies = (tokenRes.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const res = await request(app)
      .post('/api/dev/thinking/text')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', (tokenRes.body as { csrfToken: string }).csrfToken)
      .send(conversation);
    expect(res.status).toBe(404);
  });

  it('surfaces provider failures in the error envelope without internals', async () => {
    const thinkingProvider = new FakeThinkingProvider([
      new ProviderUnavailableError(undefined, { cause: new Error('connect ECONNREFUSED 10.0.0.5:11434') }),
    ]);
    const { app } = createTestApp({ thinkingProvider });
    const res = await (await browser(app)).post('/api/dev/thinking/text', conversation);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(res.text).not.toContain('10.0.0.5');
  });
});
