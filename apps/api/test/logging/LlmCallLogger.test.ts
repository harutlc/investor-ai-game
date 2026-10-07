import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LlmCallLogger, type LlmCallMeta } from '../../src/logging/LlmCallLogger.js';
import { LlmPricing } from '../../src/logging/LlmPricing.js';
import { LoggerFactory } from '../../src/logging/LoggerFactory.js';
import { RequestContext } from '../../src/logging/RequestContext.js';
import { ReportedErrors } from '../../src/monitoring/ReportedErrors.js';
import { testConfig } from '../support/testConfig.js';

type Line = Record<string, unknown> & { level: number; event?: string };

function setup(logContent = false) {
  const lines: Line[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Line);
      done();
    },
  });
  const config = testConfig({ logLevel: 'debug' });
  const logger = LoggerFactory.create(config, sink);
  const calls = new LlmCallLogger({
    logger,
    pricing: new LlmPricing(config.llm.pricing, logger),
    logContent,
  });
  const events = (name: string) => lines.filter((line) => line.event === name);
  return { calls, lines, events };
}

const META: LlmCallMeta = {
  provider: 'anthropic',
  operation: 'generate',
  model: 'claude-opus-5-5',
  priced: true,
  maxTokens: 1024,
  temperature: null,
  effort: 'low',
  fallbacks: true,
  timeoutMs: 1000,
  prompt: { system: 'You are an investor.', messages: [{ role: 'user', content: 'My secret pitch' }] },
};

const USAGE = { inputTokens: 1200, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const ok = (model = 'claude-opus-5-5') => ({
  model,
  usage: USAGE,
  stopReason: 'end_turn',
  anthropicRequestId: 'req_1',
  text: 'Deal.',
});

describe('LlmCallLogger.run', () => {
  it('logs one llm.call at info with params, usage, cost, latency, attempts and the request id', async () => {
    const { calls, events } = setup();
    await RequestContext.run({ requestId: 'http-1' }, () =>
      calls.run(
        META,
        () => Promise.resolve('r'),
        () => ok(),
      ),
    );
    const [line] = events('llm.call');
    expect(events('llm.call')).toHaveLength(1);
    expect(line).toMatchObject({
      level: 30,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      maxTokens: 1024,
      temperature: null,
      effort: 'low',
      fallbacks: true,
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
      costUsd: 0.0108,
      attempts: 1,
      stopReason: 'end_turn',
      anthropicRequestId: 'req_1',
      requestId: 'http-1',
    });
    expect(line!.latencyMs).toEqual(expect.any(Number));
    expect(line).not.toHaveProperty('requestedModel');
  });

  it('leaves the prompt and response out by default', async () => {
    const { calls, lines } = setup();
    await calls.run(
      META,
      () => Promise.resolve('r'),
      () => ok(),
    );
    expect(JSON.stringify(lines)).not.toMatch(/secret pitch|You are an investor|Deal\./);
  });

  it('includes the prompt and response when content logging is on', async () => {
    const { calls, events } = setup(true);
    await calls.run(
      META,
      () => Promise.resolve('r'),
      () => ok(),
    );
    expect(events('llm.call')[0]).toMatchObject({
      prompt: { system: 'You are an investor.', messages: [{ role: 'user', content: 'My secret pitch' }] },
      response: { text: 'Deal.' },
    });
  });

  it('names the serving model and the requested one after a fallback, priced at the serving model', async () => {
    const { calls, events } = setup();
    await calls.run(
      META,
      () => Promise.resolve('r'),
      () => ok('claude-haiku-4-5'),
    );
    expect(events('llm.call')[0]).toMatchObject({
      model: 'claude-haiku-4-5',
      requestedModel: 'claude-opus-5-5',
      costUsd: 0.0027,
    });
  });

  it('logs a refusal as llm.call_failed at error', async () => {
    const { calls, events } = setup();
    await calls.run(
      META,
      () => Promise.resolve('r'),
      () => ({ ...ok(), refusal: { category: 'cyber' } }),
    );
    expect(events('llm.call')).toHaveLength(0);
    expect(events('llm.call_failed')[0]).toMatchObject({
      level: 50,
      errorType: 'Refusal',
      category: 'cyber',
    });
  });

  it('logs ping successes at debug', async () => {
    const { calls, events } = setup();
    await calls.run(
      { ...META, operation: 'ping' },
      () => Promise.resolve('r'),
      () => ({}),
    );
    expect(events('llm.call')[0]).toMatchObject({ level: 20, operation: 'ping' });
  });

  it('logs a failure once at error, marks it reported and rethrows it unchanged', async () => {
    const { calls, events } = setup();
    class RateLimitError extends Error {
      status = 429;
      requestID = 'req_9';
    }
    const error = new RateLimitError('slow down');
    await expect(
      calls.run(
        META,
        () => Promise.reject(error),
        () => ok(),
      ),
    ).rejects.toBe(error);
    expect(events('llm.call_failed')).toHaveLength(1);
    expect(events('llm.call_failed')[0]).toMatchObject({
      level: 50,
      errorType: 'RateLimitError',
      status: 429,
      attempts: 1,
      anthropicRequestId: 'req_9',
      err: { message: 'slow down' },
    });
    expect(events('llm.call')).toHaveLength(0);
    expect(ReportedErrors.has(error)).toBe(true);
  });
});

describe('LlmCallLogger.run for self-hosted and non-Anthropic providers', () => {
  const LAYA: LlmCallMeta = {
    provider: 'laya',
    operation: 'decide',
    model: 'english',
    priced: false,
    timeoutMs: 1000,
    prompt: { state: 'My secret pitch', questions: { accept: { type: 'noul', instructions: 'yes?' } } },
  };

  it('logs an unpriced call with costUsd null and no missing-price warning', async () => {
    const { calls, events, lines } = setup();
    await calls.run(
      LAYA,
      () => Promise.resolve('r'),
      () => ({ usage: { ...USAGE, outputTokens: 20 }, providerRequestId: 'ts_1' }),
    );
    expect(events('llm.call')[0]).toMatchObject({
      provider: 'laya',
      operation: 'decide',
      costUsd: null,
      providerRequestId: 'ts_1',
    });
    expect(events('llm.call')[0]).not.toHaveProperty('anthropicRequestId');
    expect(lines.some((line) => line.event === 'llm.price_missing')).toBe(false);
  });

  it("logs a TypeSafe error's request id as providerRequestId", async () => {
    const { calls, events } = setup();
    class APIConnectionError extends Error {
      requestId = 'ts_9';
    }
    await expect(
      calls.run(
        LAYA,
        () => Promise.reject(new APIConnectionError('refused')),
        () => ({}),
      ),
    ).rejects.toThrow('refused');
    expect(events('llm.call_failed')[0]).toMatchObject({
      level: 50,
      errorType: 'APIConnectionError',
      status: null,
      providerRequestId: 'ts_9',
    });
  });

  it('logs decision state, questions and answers only when content logging is on', async () => {
    const info = () => ({ usage: USAGE, answers: { accept: { type: 'noul', probability: 0.4 } } });
    const off = setup();
    await off.calls.run(LAYA, () => Promise.resolve('r'), info);
    expect(JSON.stringify(off.lines)).not.toMatch(/secret pitch|questions|answers/);

    const on = setup(true);
    await on.calls.run(LAYA, () => Promise.resolve('r'), info);
    expect(on.events('llm.call')[0]).toMatchObject({
      prompt: { state: 'My secret pitch', questions: { accept: { type: 'noul' } } },
      response: { answers: { accept: { probability: 0.4 } } },
    });
  });

  it('logs a failed ping at warn and does not mark it reported', async () => {
    const { calls, events } = setup();
    const error = new Error('down');
    await expect(
      calls.run(
        { ...LAYA, operation: 'ping' },
        () => Promise.reject(error),
        () => ({}),
      ),
    ).rejects.toBe(error);
    expect(events('llm.call_failed')[0]).toMatchObject({ level: 40, operation: 'ping' });
    expect(ReportedErrors.has(error)).toBe(false);
  });
});

describe('LlmCallLogger.instrumentFetch', () => {
  const replies = (...responses: (Response | Error)[]) => {
    const fetch: typeof globalThis.fetch = () => {
      const next = responses.shift()!;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    };
    return fetch;
  };

  /** Mimics the SDK: retries retryable statuses and errors until a 2xx or the attempts run out. */
  async function sdkLike(fetch: typeof globalThis.fetch, attempts: number) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {});
        if (res.ok || attempt === attempts) return res;
      } catch (error) {
        if (attempt === attempts) throw error;
      }
    }
  }

  it('logs a 429 with retry-after, then the retry with its attempt number', async () => {
    const { calls, events } = setup();
    const fetch = calls.instrumentFetch(
      replies(
        new Response('{}', { status: 429, headers: { 'retry-after': '2', 'request-id': 'req_a' } }),
        new Response('{}'),
      ),
    );
    await calls.run(
      META,
      () => sdkLike(fetch, 3),
      () => ok(),
    );
    expect(events('llm.rate_limited')[0]).toMatchObject({
      level: 40,
      attempt: 1,
      retryAfterSeconds: 2,
      retryAfterMs: 2000,
      anthropicRequestId: 'req_a',
    });
    expect(events('llm.retry')[0]).toMatchObject({ level: 40, attempt: 2, reason: 'status_429' });
    expect(events('llm.call')[0]).toMatchObject({ attempts: 2 });
  });

  it('logs a 529 as llm.overloaded with retry-after-ms', async () => {
    const { calls, events } = setup();
    const fetch = calls.instrumentFetch(
      replies(new Response('{}', { status: 529, headers: { 'retry-after-ms': '1500' } }), new Response('{}')),
    );
    await calls.run(
      META,
      () => sdkLike(fetch, 2),
      () => ok(),
    );
    expect(events('llm.overloaded')[0]).toMatchObject({
      attempt: 1,
      retryAfterSeconds: 1.5,
      retryAfterMs: 1500,
    });
  });

  it('reports a missing retry-after as null', async () => {
    const { calls, events } = setup();
    const fetch = calls.instrumentFetch(replies(new Response('{}', { status: 429 }), new Response('{}')));
    await calls.run(
      META,
      () => sdkLike(fetch, 2),
      () => ok(),
    );
    expect(events('llm.rate_limited')[0]).toMatchObject({ retryAfterSeconds: null, retryAfterMs: null });
  });

  it('logs a timed-out attempt, then the retry', async () => {
    const { calls, events } = setup();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetch = calls.instrumentFetch(replies(abort, new Response('{}')));
    await calls.run(
      META,
      () => sdkLike(fetch, 2),
      () => ok(),
    );
    expect(events('llm.timeout')[0]).toMatchObject({ attempt: 1, timeoutMs: 1000 });
    expect(events('llm.retry')[0]).toMatchObject({ attempt: 2, reason: 'timeout' });
  });

  it('treats a TimeoutError from the wrapped fetch as a timeout', async () => {
    const { calls, events } = setup();
    const fetch = calls.instrumentFetch(
      replies(new DOMException('The operation timed out.', 'TimeoutError'), new Response('{}')),
    );
    await calls.run(
      META,
      () => sdkLike(fetch, 2),
      () => ok(),
    );
    expect(events('llm.timeout')[0]).toMatchObject({ attempt: 1 });
    expect(events('llm.retry')[0]).toMatchObject({ attempt: 2, reason: 'timeout' });
  });

  it('logs the TypeSafe request id header on a rate-limited attempt', async () => {
    const { calls, events } = setup();
    const fetch = calls.instrumentFetch(
      replies(
        new Response('{}', { status: 429, headers: { 'x-typesafe-request-id': 'ts_r' } }),
        new Response('{}'),
      ),
    );
    await calls.run(
      { ...META, provider: 'jev', model: 'jev-latest' },
      () => sdkLike(fetch, 2),
      () => ({}),
    );
    expect(events('llm.rate_limited')[0]).toMatchObject({ provider: 'jev', providerRequestId: 'ts_r' });
  });

  it('passes calls made outside run straight through', async () => {
    const { calls, lines } = setup();
    const fetch = calls.instrumentFetch(replies(new Response('{}', { status: 429 })));
    expect((await fetch('https://x.test')).status).toBe(429);
    expect(lines).toHaveLength(0);
  });
});

describe('LlmCallLogger.retry', () => {
  it('logs an application-level retry', () => {
    const { calls, events } = setup();
    calls.retry(META, 2, 'invalid_json');
    expect(events('llm.retry')[0]).toMatchObject({ level: 40, attempt: 2, reason: 'invalid_json' });
  });
});
