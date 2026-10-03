export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

type Handler = (request: RecordedRequest, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** A `fetch` replacement that records requests and answers from `handler`. */
export function stubFetch(handler: Handler) {
  const calls: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const text = typeof init?.body === 'string' ? init.body : undefined;
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: text === undefined ? undefined : (JSON.parse(text) as unknown),
    };
    calls.push(request);
    if (init?.signal?.aborted) throw init.signal.reason;
    return handler(request, init?.signal ?? undefined);
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Never answers; rejects when the request's signal aborts (simulates a hung backend). */
export function hang(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason as Error));
  });
}

export function connectionRefused(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') }));
}
