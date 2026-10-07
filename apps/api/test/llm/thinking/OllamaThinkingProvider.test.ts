import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaThinkingProvider } from '../../../src/llm/thinking/OllamaThinkingProvider.js';
import { LlmCallLogger } from '../../../src/logging/LlmCallLogger.js';
import { LlmPricing } from '../../../src/logging/LlmPricing.js';
import { captureLogger } from '../../support/silentLogger.js';
import {
  connectionRefused,
  hang,
  jsonResponse,
  stubFetch,
  type RecordedRequest,
} from '../../support/stubFetch.js';
import { testConfig } from '../../support/testConfig.js';

const settings = testConfig().llm.thinking.providers.ollama;

function chatReply(content: string, counts: { prompt_eval_count?: number; eval_count?: number } = {}) {
  return jsonResponse({
    model: settings.model,
    created_at: '2026-10-03T10:00:00Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    ...counts,
  });
}

function provider(
  handler: Parameters<typeof stubFetch>[0],
  overrides: Partial<typeof settings> = {},
  { logContent = false } = {},
) {
  const stub = stubFetch(handler);
  const { logger, lines } = captureLogger();
  const llmCalls = new LlmCallLogger({ logger, pricing: new LlmPricing({}, logger), logContent });
  const events = (event: string) =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.event === event);
  return {
    ...stub,
    lines,
    events,
    ollama: new OllamaThinkingProvider(
      { ...settings, ...overrides },
      { logger, fetch: stub.fetch, llmCalls },
    ),
  };
}

const ask = { system: 'You are an investor.', messages: [{ role: 'user' as const, content: 'Hi' }] };

describe('OllamaThinkingProvider', () => {
  it('sends model, messages and sampling options, and trims the reply', async () => {
    const { ollama, calls } = provider(() => chatReply('  Hello founder.  '));
    const result = await ollama.generateText(ask);
    expect(result).toMatchObject({ text: 'Hello founder.', provider: 'ollama', model: 'llama3.1:8b' });
    const [call] = calls as [RecordedRequest];
    expect(call.url).toBe('http://ollama.test:11434/api/chat');
    expect(call.body).toMatchObject({
      model: 'llama3.1:8b',
      stream: false,
      messages: [
        { role: 'system', content: 'You are an investor.' },
        { role: 'user', content: 'Hi' },
      ],
      options: { temperature: 0.8, num_predict: 512 },
    });
    expect((call.body as Record<string, unknown>).format).toBeUndefined();
  });

  it('treats an empty reply as a bad response', async () => {
    const { ollama } = provider(() => chatReply('   '));
    await expect(ollama.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
  });

  it('constrains JSON with a schema in format and parses fenced output', async () => {
    const { ollama, calls } = provider(() => chatReply('```json\n{"options":["Counter at 20%"]}\n```'));
    const schema = z.object({ options: z.array(z.string()) });
    const result = await ollama.generateJson({ ...ask, schema });
    expect(result.data).toEqual({ options: ['Counter at 20%'] });
    expect((calls[0]!.body as { format: unknown }).format).toMatchObject({
      type: 'object',
      properties: { options: { type: 'array' } },
    });
  });

  it('retries once on invalid JSON', async () => {
    const replies = ['not json', '{"options":["ok"]}'];
    const { ollama, calls } = provider(() => chatReply(replies.shift()!));
    const result = await ollama.generateJson({ ...ask, schema: z.object({ options: z.array(z.string()) }) });
    expect(result.data.options).toEqual(['ok']);
    expect(calls).toHaveLength(2);
  });

  it('maps a refused connection to PROVIDER_UNAVAILABLE after retrying', async () => {
    const { ollama, calls } = provider(connectionRefused, { maxRetries: 1 });
    await expect(ollama.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(calls).toHaveLength(2);
  });

  it('maps a timeout to PROVIDER_UNAVAILABLE', async () => {
    const { ollama } = provider((_req, signal) => hang(signal), { timeoutMs: 20, maxRetries: 0 });
    await expect(ollama.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('maps a 404 (model not found) to PROVIDER_BAD_RESPONSE without retrying', async () => {
    const { ollama, calls } = provider(() => jsonResponse({ error: 'model "x" not found' }, 404));
    await expect(ollama.generateText(ask)).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
    expect(calls).toHaveLength(1);
  });

  it('ping succeeds when the model is pulled and fails when it is not', async () => {
    const tags = (names: string[]) => jsonResponse({ models: names.map((name) => ({ name, model: name })) });
    await expect(provider(() => tags(['llama3.1:8b'])).ollama.ping()).resolves.toBeUndefined();
    const missing = provider(() => tags(['qwen2.5:7b']));
    await expect(missing.ollama.ping()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(missing.lines.join('')).toContain('ollama pull llama3.1:8b');
    expect(missing.calls[0]!.url).toBe('http://ollama.test:11434/api/tags');
  });
});

describe('OllamaThinkingProvider call logging', () => {
  it('logs a call with usage, no cost and the stop reason', async () => {
    const { ollama, events } = provider(() =>
      chatReply('Hello.', { prompt_eval_count: 900, eval_count: 150 }),
    );
    await ollama.generateText(ask);
    expect(events('llm.call')).toEqual([
      expect.objectContaining({
        level: 30,
        provider: 'ollama',
        operation: 'generate',
        model: settings.model,
        maxTokens: settings.maxTokens,
        temperature: settings.temperature,
        usage: expect.objectContaining({ inputTokens: 900, outputTokens: 150, totalTokens: 1050 }),
        costUsd: null,
        stopReason: 'stop',
        attempts: 1,
      }),
    ]);
    expect(events('llm.price_missing')).toHaveLength(0);
  });

  it('logs a 500, the retry and two attempts', async () => {
    let n = 0;
    const { ollama, events } = provider(
      () => (n++ === 0 ? jsonResponse({ error: 'boom' }, 500) : chatReply('Hello.')),
      { maxRetries: 1 },
    );
    await ollama.generateText(ask);
    expect(events('llm.retry')).toEqual([expect.objectContaining({ attempt: 2, reason: 'status_500' })]);
    expect(events('llm.call')[0]).toMatchObject({ attempts: 2 });
  });

  it('logs a timed-out attempt', async () => {
    const { ollama, events } = provider((_req, signal) => hang(signal), { timeoutMs: 20, maxRetries: 0 });
    await ollama.generateText(ask).catch(() => undefined);
    expect(events('llm.timeout')).toEqual([expect.objectContaining({ attempt: 1, timeoutMs: 20 })]);
    expect(events('llm.call_failed')[0]).toMatchObject({ level: 50, status: null });
  });

  it('logs an invalid-JSON retry and one call per reply', async () => {
    const replies = ['not json', '{"options":["ok"]}'];
    const { ollama, events } = provider(() => chatReply(replies.shift()!));
    await ollama.generateJson({ ...ask, schema: z.object({ options: z.array(z.string()) }) });
    expect(events('llm.retry')).toEqual([expect.objectContaining({ reason: 'invalid_json' })]);
    expect(events('llm.call')).toHaveLength(2);
  });

  it('logs a refused connection once at error after retrying, with no other warn or error line', async () => {
    const { ollama, events, lines } = provider(connectionRefused, { maxRetries: 1 });
    await ollama.generateText(ask).catch(() => undefined);
    expect(events('llm.call_failed')).toEqual([
      expect.objectContaining({ level: 50, provider: 'ollama', attempts: 2, status: null }),
    ]);
    const other = lines.filter((line) => !line.includes('"llm.'));
    expect(other).toEqual([]);
  });

  it('logs the HTTP status of a failed call', async () => {
    const { ollama, events } = provider(() => jsonResponse({ error: 'model "x" not found' }, 404));
    await ollama.generateText(ask).catch(() => undefined);
    expect(events('llm.call_failed')[0]).toMatchObject({ status: 404 });
  });

  it('logs a missing model on ping at warn, next to the pull hint', async () => {
    const { ollama, events, lines } = provider(() => jsonResponse({ models: [] }));
    await ollama.ping().catch(() => undefined);
    expect(events('llm.call_failed')).toEqual([expect.objectContaining({ level: 40, operation: 'ping' })]);
    expect(lines.join('')).toContain(`ollama pull ${settings.model}`);
  });

  it('logs the prompt and response only when content logging is on', async () => {
    const off = provider(() => chatReply('Secret reply.'));
    await off.ollama.generateText(ask);
    expect(off.lines.join('')).not.toMatch(/You are an investor|Secret reply/);

    const on = provider(() => chatReply('Secret reply.'), {}, { logContent: true });
    await on.ollama.generateText(ask);
    expect(on.events('llm.call')[0]).toMatchObject({
      prompt: { system: 'You are an investor.', messages: [{ role: 'user', content: 'Hi' }] },
      response: { text: 'Secret reply.' },
    });
  });
});
