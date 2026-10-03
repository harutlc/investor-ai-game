import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaThinkingProvider } from '../../../src/llm/thinking/OllamaThinkingProvider.js';
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

function chatReply(content: string) {
  return jsonResponse({
    model: settings.model,
    created_at: '2026-10-03T10:00:00Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
  });
}

function provider(handler: Parameters<typeof stubFetch>[0], overrides: Partial<typeof settings> = {}) {
  const stub = stubFetch(handler);
  const { logger, lines } = captureLogger();
  return {
    ...stub,
    lines,
    ollama: new OllamaThinkingProvider({ ...settings, ...overrides }, { logger, fetch: stub.fetch }),
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
