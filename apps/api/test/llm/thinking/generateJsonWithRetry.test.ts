import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProviderBadResponseError } from '../../../src/llm/errors/ProviderBadResponseError.js';
import { generateJsonWithRetry, type LlmMessage } from '../../../src/llm/thinking/ThinkingProvider.js';

const schema = z.object({ options: z.array(z.string()).min(1) });
const request = { messages: [{ role: 'user', content: 'Give options' }] as LlmMessage[], schema };

describe('generateJsonWithRetry', () => {
  it('returns the first valid reply without retrying', async () => {
    const complete = vi.fn().mockResolvedValue('{"options":["a"]}');
    await expect(generateJsonWithRetry(request, complete)).resolves.toEqual({ options: ['a'] });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('retries once with the bad reply and the issues, then succeeds', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce('{"options":[]}')
      .mockResolvedValueOnce('{"options":["b"]}');
    await expect(generateJsonWithRetry(request, complete)).resolves.toEqual({ options: ['b'] });
    const retryMessages = complete.mock.calls[1]![0] as LlmMessage[];
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[1]).toEqual({ role: 'assistant', content: '{"options":[]}' });
    expect(retryMessages[2]!.role).toBe('user');
    expect(retryMessages[2]!.content).toContain('options:');
  });

  it('fails with PROVIDER_BAD_RESPONSE after two invalid replies', async () => {
    const complete = vi.fn().mockResolvedValue('not json');
    const error = await generateJsonWithRetry(request, complete).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderBadResponseError);
    expect((error as ProviderBadResponseError).code).toBe('PROVIDER_BAD_RESPONSE');
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
