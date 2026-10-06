/**
 * Errors already sent to Sentry through an `error` log line by the code that saw them first (for example
 * the LLM call logger). The HTTP error handler checks it, so one failure never becomes two events.
 */
export class ReportedErrors {
  private static readonly reported = new WeakSet<object>();

  static mark(error: unknown): void {
    if (typeof error === 'object' && error !== null) ReportedErrors.reported.add(error);
  }

  /** True when `error`, or any error in its `cause` chain, has been reported. */
  static has(error: unknown): boolean {
    for (let current = error, depth = 0; current && depth < 5; depth++) {
      if (typeof current !== 'object') return false;
      if (ReportedErrors.reported.has(current)) return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }
}
