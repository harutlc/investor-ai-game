/** Runs `fn` up to `attempts` times, retrying only errors `isRetryable` accepts; rethrows the last error. */
export async function withRetry<T>(
  attempts: number,
  fn: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
    }
  }
  throw lastError;
}
