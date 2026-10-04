/** Loads a CSRF token, or resolves null when the server has CSRF protection turned off. */
export type CsrfTokenLoader = () => Promise<string | null>;

type State = { kind: 'unknown' } | { kind: 'disabled' } | { kind: 'token'; token: string };

/**
 * The player's CSRF token, fetched the first time a mutation needs it. A server with CSRF off answers
 * the token endpoint with 404; that is remembered, so the endpoint is asked only once. Concurrent first
 * mutations share one load.
 */
export class CsrfTokenStore {
  private state: State = { kind: 'unknown' };
  private loading: Promise<string | null> | null = null;

  constructor(private readonly load: CsrfTokenLoader) {}

  /** The token to send, or null when none is needed. */
  async token(): Promise<string | null> {
    if (this.state.kind === 'disabled') return null;
    if (this.state.kind === 'token') return this.state.token;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    const token = await this.loading;
    this.state = token === null ? { kind: 'disabled' } : { kind: 'token', token };
    return token;
  }

  /** Forgets the token after the server rejected it, so the next call loads a fresh one. */
  invalidate(): void {
    this.state = { kind: 'unknown' };
  }
}
