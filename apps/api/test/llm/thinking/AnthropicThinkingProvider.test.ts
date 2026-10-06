import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicThinkingProvider } from '../../../src/llm/thinking/AnthropicThinkingProvider.js';
import { LlmCallLogger } from '../../../src/logging/LlmCallLogger.js';
import { LlmPricing } from '../../../src/logging/LlmPricing.js';
import { LoggerFactory } from '../../../src/logging/LoggerFactory.js';
import { RequestContext } from '../../../src/logging/RequestContext.js';
import { ReportedErrors } from '../../../src/monitoring/ReportedErrors.js';
import { captureLogger } from '../../support/silentLogger.js';
import {
  connectionRefused,
  hang,
  jsonResponse,
  stubFetch,
  type RecordedRequest,
} from '../../support/stubFetch.js';
import { testConfig } from '../../support/testConfig.js';

const API_KEY = 'sk-ant-test-0123456789-never-log-me';
const settings = testConfig().llm.thinking.providers.anthropic;

function message(content: { type: string; text?: string }[], stop_reason = 'end_turn', extra = {}) {
  return jsonResponse(
    {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: settings.model,
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
      ...extra,
    },
    200,
    { 'request-id': 'req_test' },
  );
}

const text = (value: string) => message([{ type: 'text', text: value }]);

function provider(handler: Parameters<typeof stubFetch>[0], overrides: Partial<typeof settings> = {}) {
  const stub = stubFetch(handler);
  const { logger, lines } = captureLogger();
  return {
    ...stub,
    lines,
    anthropic: new AnthropicThinkingProvider({ ...settings, ...overrides }, API_KEY, {
      logger,
      fetch: stub.fetch,
    }),
  };
}

const ask = { system: 'You are a rude investor.', messages: [{ role: 'user' as const, content: 'Hi' }] };

describe('AnthropicThinkingProvider', () => {
  it('sends model, effort and the default fallback, never temperature', async () => {
    const { anthropic, calls } = provider(() => text('Hello.'));
    const result = await anthropic.generateText(ask);
    expect(result).toMatchObject({ text: 'Hello.', provider: 'anthropic', model: 'claude-opus-5-5' });

    const [call] = calls as [RecordedRequest];
    expect(call.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(call.headers.get('x-api-key')).toBe(API_KEY);
    expect(call.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      system: 'You are a rude investor.',
      messages: [{ role: 'user', content: 'Hi' }],
      output_config: { effort: 'low' },
      fallbacks: 'default',
    });
    expect(call.body).not.toHaveProperty('temperature');
    expect(call.body).not.toHaveProperty('thinking');
  });

  it('omits the fallback beta when disabled', async () => {
    const { anthropic, calls } = provider(() => text('Hi.'), { fallbacks: false });
    await anthropic.generateText(ask);
    expect(calls[0]!.headers.get('anthropic-beta')).toBeNull();
    expect(calls[0]!.body).not.toHaveProperty('fallbacks');
  });

  it('joins text blocks and ignores thinking blocks', async () => {
    const { anthropic } = provider(() =>
      message([
        { type: 'thinking', text: '' },
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two.' },
      ]),
    );
    expect((await anthropic.generateText(ask)).text).toBe('Part one. Part two.');
  });

  it('constrains JSON with a json_schema output format and parses the reply', async () => {
    const { anthropic, calls } = provider(() => text('{"options":["Accept 24%","Walk away"]}'));
    const result = await anthropic.generateJson({
      ...ask,
      schema: z.object({ options: z.array(z.string()) }),
    });
    expect(result.data.options).toEqual(['Accept 24%', 'Walk away']);
    const format = (calls[0]!.body as { output_config: { format: { type: string; schema: unknown } } })
      .output_config.format;
    expect(format.type).toBe('json_schema');
    expect(format.schema).toMatchObject({ type: 'object', properties: { options: { type: 'array' } } });
  });

  it('maps a refusal to PROVIDER_BAD_RESPONSE', async () => {
    const { anthropic, lines } = provider(() =>
      message([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
    );
    await expect(anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
    expect(lines.join('')).toContain('"category":"cyber"');
  });

  it('maps 529 overload and refused connections to PROVIDER_UNAVAILABLE', async () => {
    const overloaded = provider(() =>
      jsonResponse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529),
    );
    await expect(overloaded.anthropic.generateText(ask)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    const down = provider(connectionRefused);
    await expect(down.anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('maps 401 to PROVIDER_UNAVAILABLE and names the env var without leaking the key', async () => {
    const { anthropic, lines } = provider(() =>
      jsonResponse(
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        401,
      ),
    );
    await expect(anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    const log = lines.join('');
    expect(log).toContain('ANTHROPIC_API_KEY');
    expect(log).not.toContain(API_KEY);
  });

  it('maps 400 to PROVIDER_BAD_RESPONSE', async () => {
    const { anthropic } = provider(() =>
      jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 400),
    );
    await expect(anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
  });

  it('pings by retrieving the configured model', async () => {
    const ok = provider(() => jsonResponse({ id: settings.model, type: 'model', display_name: 'Claude' }));
    await expect(ok.anthropic.ping()).resolves.toBeUndefined();
    expect(ok.calls[0]!.url).toContain(`/v1/models/${settings.model}`);
    const bad = provider(() =>
      jsonResponse({ type: 'error', error: { type: 'not_found_error', message: 'x' } }, 404),
    );
    await expect(bad.anthropic.ping()).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
  });
});

describe('AnthropicThinkingProvider call logging', () => {
  type Line = Record<string, unknown> & { level: number; event?: string };

  function logged(
    handler: Parameters<typeof stubFetch>[0],
    overrides: Partial<typeof settings> = {},
    logContent = false,
  ) {
    const stub = stubFetch(handler);
    const raw: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        raw.push(chunk.toString());
        done();
      },
    });
    const config = testConfig({ logLevel: 'debug' });
    const logger = LoggerFactory.create(config, sink);
    const llmCalls = new LlmCallLogger({
      logger,
      pricing: new LlmPricing(config.llm.pricing, logger),
      logContent,
    });
    const anthropic = new AnthropicThinkingProvider({ ...settings, ...overrides }, API_KEY, {
      logger,
      fetch: stub.fetch,
      llmCalls,
    });
    const lines = () => raw.map((line) => JSON.parse(line) as Line);
    const events = (name: string) => lines().filter((line) => line.event === name);
    return { anthropic, calls: stub.calls, raw, lines, events };
  }

  const apiError = (status: number, type: string, headers: Record<string, string> = {}) =>
    jsonResponse({ type: 'error', error: { type, message: type } }, status, {
      'request-id': 'req_err',
      ...headers,
    });

  it('logs a successful call once at info with usage, cost and the HTTP request id', async () => {
    const { anthropic, events } = logged(() => text('Hello.'));
    await RequestContext.run({ requestId: 'http-42' }, () => anthropic.generateText(ask));
    expect(events('llm.call')).toHaveLength(1);
    expect(events('llm.call')[0]).toMatchObject({
      level: 30,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      maxTokens: 1024,
      temperature: null,
      effort: 'low',
      fallbacks: true,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 15,
      },
      costUsd: 0.00014,
      attempts: 1,
      stopReason: 'end_turn',
      anthropicRequestId: 'req_test',
      requestId: 'http-42',
    });
  });

  it('logs a 429 (with retry-after) and the retry, then the call with attempts: 2', async () => {
    let n = 0;
    const { anthropic, events } = logged(
      () => (n++ === 0 ? apiError(429, 'rate_limit_error', { 'retry-after-ms': '5' }) : text('Hi.')),
      { maxRetries: 2 },
    );
    await anthropic.generateText(ask);
    expect(events('llm.rate_limited')).toHaveLength(1);
    expect(events('llm.rate_limited')[0]).toMatchObject({
      level: 40,
      attempt: 1,
      retryAfterMs: 5,
      status: 429,
    });
    expect(events('llm.retry')[0]).toMatchObject({ level: 40, attempt: 2, reason: 'status_429' });
    expect(events('llm.call')[0]).toMatchObject({ level: 30, attempts: 2 });
    expect(events('llm.call_failed')).toHaveLength(0);
  });

  it('logs a 529 as llm.overloaded', async () => {
    const { anthropic, events } = logged(() => apiError(529, 'overloaded_error'));
    await expect(anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(events('llm.overloaded')[0]).toMatchObject({ attempt: 1, status: 529, retryAfterSeconds: null });
  });

  it('logs exhausted retries as one llm.call_failed at error', async () => {
    const { anthropic, events, calls } = logged(
      () => apiError(429, 'rate_limit_error', { 'retry-after-ms': '1' }),
      {
        maxRetries: 2,
      },
    );
    await expect(anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(calls).toHaveLength(3);
    expect(events('llm.rate_limited')).toHaveLength(3);
    expect(events('llm.call_failed')).toHaveLength(1);
    expect(events('llm.call_failed')[0]).toMatchObject({
      level: 50,
      errorType: 'RateLimitError',
      status: 429,
      attempts: 3,
      anthropicRequestId: 'req_err',
    });
  });

  it('logs a timed-out attempt and the retry', async () => {
    let n = 0;
    const { anthropic, events } = logged(
      (_request, signal) => (n++ === 0 ? hang(signal) : text('Late but fine.')),
      { timeoutMs: 50, maxRetries: 1 },
    );
    await anthropic.generateText(ask);
    expect(events('llm.timeout')[0]).toMatchObject({ level: 40, attempt: 1, timeoutMs: 50 });
    expect(events('llm.retry')[0]).toMatchObject({ attempt: 2, reason: 'timeout' });
    expect(events('llm.call')[0]).toMatchObject({ attempts: 2 });
  });

  it('logs 401 as AuthenticationError and still answers PROVIDER_UNAVAILABLE', async () => {
    const { anthropic, events, raw } = logged(() => apiError(401, 'authentication_error'));
    await expect(anthropic.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(events('llm.call_failed')).toHaveLength(1);
    expect(events('llm.call_failed')[0]).toMatchObject({ errorType: 'AuthenticationError', status: 401 });
    expect(raw.join('')).not.toContain(API_KEY);
  });

  it('marks a failure as reported, so the HTTP error handler does not report it again', async () => {
    const { anthropic } = logged(() => apiError(500, 'api_error'));
    const error = await anthropic.generateText(ask).catch((e: unknown) => e);
    expect(ReportedErrors.has(error)).toBe(true);
  });

  it('logs a refusal once as llm.call_failed', async () => {
    const { anthropic, events } = logged(() =>
      message([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
    );
    const error = await anthropic.generateText(ask).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
    expect(ReportedErrors.has(error)).toBe(true);
    expect(events('llm.call_failed')).toHaveLength(1);
    expect(events('llm.call_failed')[0]).toMatchObject({
      level: 50,
      errorType: 'Refusal',
      category: 'cyber',
    });
  });

  it('prices a fallback-served response at the serving model', async () => {
    const { anthropic, events } = logged(() =>
      message([{ type: 'text', text: 'Fine.' }], 'end_turn', { model: 'claude-haiku-4-5' }),
    );
    await anthropic.generateText(ask);
    expect(events('llm.call')[0]).toMatchObject({
      model: 'claude-haiku-4-5',
      requestedModel: 'claude-opus-5-5',
      costUsd: 0.000035,
    });
  });

  it('logs the invalid-JSON retry and both calls', async () => {
    let n = 0;
    const { anthropic, events } = logged(() => text(n++ === 0 ? 'not json' : '{"ok":true}'));
    await anthropic.generateJson({ ...ask, schema: z.object({ ok: z.boolean() }) });
    expect(events('llm.retry')).toHaveLength(1);
    expect(events('llm.retry')[0]).toMatchObject({ attempt: 2, reason: 'invalid_json' });
    expect(events('llm.call')).toHaveLength(2);
  });

  it('logs pings at debug', async () => {
    const { anthropic, events } = logged(() =>
      jsonResponse({ id: settings.model, type: 'model', display_name: 'Claude' }),
    );
    await anthropic.ping();
    expect(events('llm.call')[0]).toMatchObject({ level: 20, operation: 'ping' });
  });

  it('keeps prompts and responses out of the logs unless content logging is on', async () => {
    const off = logged(() => text('Secret answer.'));
    await off.anthropic.generateText(ask);
    expect(off.raw.join('')).not.toMatch(/rude investor|Secret answer/);

    const on = logged(() => text('Secret answer.'), {}, true);
    await on.anthropic.generateText(ask);
    expect(on.events('llm.call')[0]).toMatchObject({
      prompt: { system: 'You are a rude investor.', messages: [{ role: 'user', content: 'Hi' }] },
      response: { text: 'Secret answer.' },
    });
    expect(on.raw.join('')).not.toContain(API_KEY);
  });
});
