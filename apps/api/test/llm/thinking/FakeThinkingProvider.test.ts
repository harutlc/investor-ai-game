import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProviderUnavailableError } from '../../../src/llm/errors/ProviderUnavailableError.js';
import { FakeThinkingProvider } from '../../../src/llm/thinking/FakeThinkingProvider.js';

const user = (content: string) => ({ messages: [{ role: 'user' as const, content }] });

describe('FakeThinkingProvider', () => {
  it('echoes the last user message by default', async () => {
    const result = await new FakeThinkingProvider().generateText(user('hello'));
    expect(result).toEqual({ text: '[fake] hello', provider: 'fake', model: 'fake', latencyMs: 0 });
  });

  it('serves scripted replies in order and records requests', async () => {
    const fake = new FakeThinkingProvider(['one']).enqueue('two');
    expect((await fake.generateText(user('a'))).text).toBe('one');
    expect((await fake.generateText(user('b'))).text).toBe('two');
    expect(fake.requests).toHaveLength(2);
  });

  it('throws scripted errors', async () => {
    const fake = new FakeThinkingProvider([new ProviderUnavailableError()]);
    await expect(fake.generateText(user('a'))).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('parses scripted JSON, including the retry path', async () => {
    const fake = new FakeThinkingProvider(['oops', '{"n": 2}']);
    const result = await fake.generateJson({ ...user('n?'), schema: z.object({ n: z.number() }) });
    expect(result.data).toEqual({ n: 2 });
  });

  it('fails JSON requests without a script', async () => {
    await expect(
      new FakeThinkingProvider().generateJson({ ...user('n?'), schema: z.object({ n: z.number() }) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
  });

  it('reports health as configured', async () => {
    const fake = new FakeThinkingProvider();
    await expect(fake.ping()).resolves.toBeUndefined();
    await expect(fake.setHealthy(false).ping()).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
