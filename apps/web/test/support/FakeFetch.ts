export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

type Reply = Response | Error | (() => Response);

/** A scripted `fetch`: replies are served in order and every call is recorded. */
export class FakeFetch {
  readonly calls: RecordedCall[] = [];
  private readonly replies: Reply[] = [];

  reply(...replies: Reply[]): this {
    this.replies.push(...replies);
    return this;
  }

  readonly fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = (init.headers ?? {}) as Record<string, string>;
    this.calls.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      credentials: init.credentials,
    });
    const next = this.replies.shift();
    if (next === undefined) return Promise.reject(new Error(`No scripted reply for ${url}`));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(typeof next === 'function' ? next() : next);
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' },
  });
}

export function apiError(status: number, code: string, message = code): Response {
  return json(status, { error: { code, message, requestId: 'req-1' } });
}
