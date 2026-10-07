import { describe, expect, it } from 'vitest';
import { SystemOneDecisionProvider } from '../../../src/llm/decision/SystemOneDecisionProvider.js';
import { LlmCallLogger } from '../../../src/logging/LlmCallLogger.js';
import { LlmPricing } from '../../../src/logging/LlmPricing.js';
import { captureLogger } from '../../support/silentLogger.js';
import { connectionRefused, jsonResponse, stubFetch, type RecordedRequest } from '../../support/stubFetch.js';
import { testConfig } from '../../support/testConfig.js';
import { tutorQuestions, tutorState, tutorWireAnswers } from './fixtures.js';

const TYPESAFE_KEY = 'ts-live-key-never-log-me';
const config = testConfig();
const { jev: jevSettings, laya: layaSettings } = config.llm.decision.providers;

const systemOne = (answers: unknown = tutorWireAnswers, model = 'jev-1') =>
  jsonResponse({ model, answers, usage: { input_tokens: 296, output_tokens: 20 } });

function build(
  name: 'jev' | 'laya',
  handler: Parameters<typeof stubFetch>[0],
  apiKey?: string,
  { logContent = false, maxRetries = 0 } = {},
) {
  const stub = stubFetch(handler);
  const { logger, lines } = captureLogger();
  const settings = { ...(name === 'jev' ? jevSettings : layaSettings), maxRetries };
  const llmCalls = new LlmCallLogger({
    logger,
    pricing: new LlmPricing(config.llm.pricing, logger),
    logContent,
  });
  const events = (event: string) =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.event === event);
  return {
    ...stub,
    lines,
    events,
    provider: new SystemOneDecisionProvider(name, settings, apiKey, { logger, fetch: stub.fetch, llmCalls }),
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

    expect(result).toMatchObject({
      provider: 'jev',
      model: 'jev-1',
      usage: { inputTokens: 296, outputTokens: 20 },
    });
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

  it('logs the failure at error and the key name, never the key, at warn on 401', async () => {
    const { provider, lines, events } = build(
      'jev',
      () => jsonResponse({ error: { message: 'bad key' } }, 401),
      TYPESAFE_KEY,
    );
    await provider.decide(request).catch(() => undefined);
    expect(events('llm.call_failed')).toEqual([
      expect.objectContaining({ level: 50, errorType: 'AuthenticationError', status: 401 }),
    ]);
    const hint = lines.find((line) => line.includes('TYPESAFE_API_KEY'));
    expect(JSON.parse(hint!)).toMatchObject({ level: 40 });
    expect(lines.join('')).not.toContain(TYPESAFE_KEY);
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

describe('SystemOneDecisionProvider call logging', () => {
  const levels = (lines: string[]) => lines.map((line) => (JSON.parse(line) as { level: number }).level);

  it('logs a Jev decision with usage, cost and the TypeSafe request id', async () => {
    const { provider, events } = build(
      'jev',
      () =>
        jsonResponse(
          { model: 'jev-1.13.0', answers: tutorWireAnswers, usage: { input_tokens: 296, output_tokens: 20 } },
          200,
          {
            'x-typesafe-request-id': 'ts_123',
          },
        ),
      TYPESAFE_KEY,
    );
    await provider.decide(request);
    expect(events('llm.call')[0]).not.toHaveProperty('temperature');
    expect(events('llm.call')).toEqual([
      expect.objectContaining({
        level: 30,
        provider: 'jev',
        operation: 'decide',
        model: 'jev-1.13.0',
        requestedModel: 'jev-latest',
        usage: expect.objectContaining({ inputTokens: 296, outputTokens: 20, totalTokens: 316 }),
        costUsd: 0.000396,
        attempts: 1,
        providerRequestId: 'ts_123',
      }),
    ]);
  });

  it('logs a Laya decision without a cost or a missing-price warning', async () => {
    const { provider, events } = build('laya', () => systemOne(tutorWireAnswers, 'english'));
    await provider.decide(request);
    expect(events('llm.call')[0]).toMatchObject({ provider: 'laya', costUsd: null });
    expect(events('llm.price_missing')).toHaveLength(0);
  });

  it('logs a 503 then the retry, and the call with two attempts', async () => {
    let n = 0;
    const { provider, events } = build(
      'laya',
      () =>
        n++ === 0 ? jsonResponse({}, 503, { 'retry-after-ms': '1' }) : systemOne(tutorWireAnswers, 'english'),
      undefined,
      { maxRetries: 1 },
    );
    await provider.decide(request);
    expect(events('llm.retry')).toEqual([expect.objectContaining({ attempt: 2, reason: 'status_503' })]);
    expect(events('llm.call')[0]).toMatchObject({ attempts: 2 });
  });

  it('logs a 429 with its retry-after', async () => {
    let n = 0;
    const { provider, events } = build(
      'jev',
      () => (n++ === 0 ? jsonResponse({}, 429, { 'retry-after-ms': '5' }) : systemOne()),
      TYPESAFE_KEY,
      { maxRetries: 1 },
    );
    await provider.decide(request);
    expect(events('llm.rate_limited')[0]).toMatchObject({ provider: 'jev', attempt: 1, retryAfterMs: 5 });
  });

  it('logs a refused connection once, at error, with no other warn or error line', async () => {
    const { provider, events, lines } = build('laya', connectionRefused);
    await expect(provider.decide(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(events('llm.call_failed')).toEqual([
      expect.objectContaining({ level: 50, provider: 'laya', status: null }),
    ]);
    const failures = lines.filter((line) => !line.includes('"llm.'));
    expect(levels(failures).filter((level) => level >= 40)).toEqual([]);
  });

  it('logs an unknown label as a failed call', async () => {
    const answers = {
      ...tutorWireAnswers,
      reaction: { ...tutorWireAnswers.reaction, choice: 'buy_company' },
    };
    const { provider, events } = build('jev', () => systemOne(answers), TYPESAFE_KEY);
    await provider.decide(request).catch(() => undefined);
    expect(events('llm.call')).toHaveLength(0);
    expect(events('llm.call_failed')[0]).toMatchObject({ errorType: 'ProviderBadResponseError' });
  });

  it('logs an unreachable Laya ping at warn', async () => {
    const { provider, events } = build('laya', connectionRefused);
    await provider.ping().catch(() => undefined);
    expect(events('llm.call_failed')).toEqual([expect.objectContaining({ level: 40, operation: 'ping' })]);
  });

  it('logs state, questions and answers only when content logging is on', async () => {
    const off = build('laya', () => systemOne(tutorWireAnswers, 'english'));
    await off.provider.decide(request);
    expect(off.events('llm.call')[0]).not.toHaveProperty('prompt');
    expect(off.events('llm.call')[0]).not.toHaveProperty('response');

    const on = build('laya', () => systemOne(tutorWireAnswers, 'english'), undefined, { logContent: true });
    await on.provider.decide(request);
    expect(on.events('llm.call')[0]).toMatchObject({
      prompt: { state: tutorState, questions: tutorQuestions },
      response: { answers: { reaction: { type: 'choice', value: 'counter' } } },
    });
  });

  it('never logs the key', async () => {
    const { provider, lines } = build(
      'jev',
      () => jsonResponse({}, 429, { 'retry-after-ms': '1' }),
      TYPESAFE_KEY,
      { logContent: true },
    );
    await provider.decide(request).catch(() => undefined);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain(TYPESAFE_KEY);
  });
});
