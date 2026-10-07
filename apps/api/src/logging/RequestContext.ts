import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextValue {
  requestId: string;
}

/**
 * The request being handled, carried across `await`s so that code holding only the root logger (providers,
 * the brain, repositories) still logs the request id. Empty outside a request.
 */
export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextValue>();

  static run<T>(value: RequestContextValue, fn: () => T): T {
    return RequestContext.storage.run(value, fn);
  }

  static get(): RequestContextValue | undefined {
    return RequestContext.storage.getStore();
  }
}
