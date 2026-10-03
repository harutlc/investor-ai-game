import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicThinkingProvider } from '../../../src/llm/thinking/AnthropicThinkingProvider.js';
import { captureLogger } from '../../support/silentLogger.js';
import { connectionRefused, jsonResponse, stubFetch, type RecordedRequest } from '../../support/stubFetch.js';
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
