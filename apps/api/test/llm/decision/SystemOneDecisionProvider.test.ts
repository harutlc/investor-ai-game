import { describe, expect, it } from 'vitest';
import { SystemOneDecisionProvider } from '../../../src/llm/decision/SystemOneDecisionProvider.js';
import { captureLogger } from '../../support/silentLogger.js';
import { connectionRefused, jsonResponse, stubFetch, type RecordedRequest } from '../../support/stubFetch.js';
import { testConfig } from '../../support/testConfig.js';
import { tutorQuestions, tutorState, tutorWireAnswers } from './fixtures.js';

const TYPESAFE_KEY = 'ts-live-key-never-log-me';
const { jev: jevSettings, laya: layaSettings } = testConfig().llm.decision.providers;

const systemOne = (answers: unknown = tutorWireAnswers, model = 'jev-1') =>
  jsonResponse({ model, answers, usage: { input_tokens: 296, output_tokens: 20 } });

function build(name: 'jev' | 'laya', handler: Parameters<typeof stubFetch>[0], apiKey?: string) {
  const stub = stubFetch(handler);
  const { logger, lines } = captureLogger();
  const settings = name === 'jev' ? jevSettings : layaSettings;
  return {
    ...stub,
    lines,
    provider: new SystemOneDecisionProvider(name, settings, apiKey, { logger, fetch: stub.fetch }),
  };
}

const request = { state: tutorState, questions: tutorQuestions };

describe('SystemOneDecisionProvider (Jev)', () => {
  it('posts state, questions and model with the bearer key', async () => {
    const { provider, calls } = build('jev', () => systemOne(), TYPESAFE_KEY);
    const result = await provider.decide(request);

    const [call] = calls as [RecordedRequest];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://jev.test/v1/systemone');
    expect(call.headers.get('authorization')).toBe(`Bearer ${TYPESAFE_KEY}`);
    expect(call.body).toEqual({ state: tutorState, questions: tutorQuestions, model: 'jev-latest' });

    expect(result).toMatchObject({ provider: 'jev', model: 'jev-1', usage: { inputTokens: 296 } });
    expect(result.answers.reaction).toMatchObject({ type: 'choice', value: 'counter', confidence: 0.8 });
    expect(result.answers.good_deal).toEqual({ type: 'noul', probability: 0.31 });
    expect(result.answers.accept).toMatchObject({ type: 'score', value: 1.2 });
    expect(result.answers.reaction).not.toHaveProperty('answer_confidence');
  });

  it('runs requests in parallel and returns them in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { provider } = build(
      'jev',
      async (req) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        const state = (req.body as { state: string }).state;
        return systemOne({ q: { type: 'noul', noul: Number(state) / 10 } });
      },
      TYPESAFE_KEY,
    );
    const question = { q: { type: 'noul', instructions: 'yes?' } } as const;
    const results = await provider.decideMany(
      ['1', '2', '3'].map((state) => ({ state, questions: question })),
    );
    expect(maxInFlight).toBe(3);
    expect(results.map((r) => r.answers.q)).toEqual([
      { type: 'noul', probability: 0.1 },
      { type: 'noul', probability: 0.2 },
      { type: 'noul', probability: 0.3 },
    ]);
  });

  it('rejects invalid questions before sending anything', async () => {
    const { provider, calls } = build('jev', () => systemOne(), TYPESAFE_KEY);
    await expect(provider.decide({ state: 'x', questions: {} })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, 'PROVIDER_UNAVAILABLE'],
    [429, 'PROVIDER_UNAVAILABLE'],
    [529, 'PROVIDER_UNAVAILABLE'],
    [422, 'PROVIDER_BAD_RESPONSE'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const { provider } = build(
      'jev',
      () => jsonResponse({ error: { message: 'nope' } }, status),
      TYPESAFE_KEY,
    );
    await expect(provider.decide(request)).rejects.toMatchObject({ code });
  });

  it('logs the key name, never the key, on 401', async () => {
    const { provider, lines } = build(
      'jev',
      () => jsonResponse({ error: { message: 'bad key' } }, 401),
      TYPESAFE_KEY,
    );
    await provider.decide(request).catch(() => undefined);
    const log = lines.join('');
    expect(log).toContain('TYPESAFE_API_KEY');
    expect(log).not.toContain(TYPESAFE_KEY);
  });

  it('maps a refused connection to PROVIDER_UNAVAILABLE', async () => {
    const { provider } = build('jev', connectionRefused, TYPESAFE_KEY);
    await expect(provider.decide(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('maps a malformed response body to PROVIDER_BAD_RESPONSE', async () => {
    const { provider } = build('jev', () => jsonResponse({ unexpected: true }), TYPESAFE_KEY);
    await expect(provider.decide(request)).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
  });

  it('maps an unknown label to PROVIDER_BAD_RESPONSE', async () => {
    const answers = {
      ...tutorWireAnswers,
      reaction: { ...tutorWireAnswers.reaction, choice: 'buy_company' },
    };
    const { provider } = build('jev', () => systemOne(answers), TYPESAFE_KEY);
    await expect(provider.decide(request)).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
  });

  it('pings by listing models with the key', async () => {
    const { provider, calls } = build(
      'jev',
      () => jsonResponse({ models: [{ name: 'jev-1', description: '', release_date: '' }] }),
      TYPESAFE_KEY,
    );
    await expect(provider.ping()).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('https://jev.test/v1/models');
    const denied = build('jev', () => jsonResponse({ error: {} }, 401), TYPESAFE_KEY);
    await expect(denied.provider.ping()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('SystemOneDecisionProvider (Laya)', () => {
  it('talks to laya-serve with the Laya model and no real key', async () => {
    const { provider, calls } = build('laya', () => systemOne(tutorWireAnswers, 'english'));
    const result = await provider.decide(request);
    expect(calls[0]!.url).toBe('http://laya.test:8000/v1/systemone');
    expect((calls[0]!.body as { model: string }).model).toBe('english');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer unused');
    expect(result).toMatchObject({ provider: 'laya', model: 'english' });
  });

  it('pings /health, with the bearer key only when configured', async () => {
    const keyless = build('laya', () => jsonResponse({ status: 'ok' }));
    await expect(keyless.provider.ping()).resolves.toBeUndefined();
    expect(keyless.calls[0]!.url).toBe('http://laya.test:8000/health');
    expect(keyless.calls[0]!.headers.get('authorization')).toBeNull();

    const keyed = build('laya', () => jsonResponse({ status: 'ok' }), 'laya-key');
    await keyed.provider.ping();
    expect(keyed.calls[0]!.headers.get('authorization')).toBe('Bearer laya-key');
  });

  it('reports an unreachable laya-serve as PROVIDER_UNAVAILABLE', async () => {
    const down = build('laya', connectionRefused);
    await expect(down.provider.decide(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(down.provider.ping()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
