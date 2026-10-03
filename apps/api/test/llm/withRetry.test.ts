import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/llm/withRetry.js';

const retryable = new Error('retryable');
const fatal = new Error('fatal');
const isRetryable = (error: unknown) => error === retryable;

describe('withRetry', () => {
  it('returns the first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(3, fn, isRetryable)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors until success', async () => {
    const fn = vi.fn().mockRejectedValueOnce(retryable).mockResolvedValue('ok');
    await expect(withRetry(3, fn, isRetryable)).resolves.toBe('ok');
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  it('does not retry other errors', async () => {
    const fn = vi.fn().mockRejectedValue(fatal);
    await expect(withRetry(3, fn, isRetryable)).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops at the attempt limit and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(retryable);
    await expect(withRetry(3, fn, isRetryable)).rejects.toBe(retryable);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('always makes at least one attempt', async () => {
    const fn = vi.fn().mockResolvedValue(1);
    await withRetry(0, fn, isRetryable);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
