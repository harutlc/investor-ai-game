import type { ErrorCode } from '@investor/shared';

/** The API's own error codes, plus the client-side failures that never reach the API's envelope. */
export type ApiClientErrorCode = ErrorCode | 'BAD_RESPONSE' | 'UNKNOWN' | 'NETWORK_ERROR';

interface ApiClientErrorInit {
  code: ApiClientErrorCode;
  message: string;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  requestId?: string | null;
  details?: unknown;
  cause?: unknown;
}

/** Every failure of an API call: a non-2xx envelope, an unexpected body, or a network error. */
export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(init: ApiClientErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiClientError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.details = init.details;
  }

  /** True for a 4xx answer: retrying the same request will not help. */
  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}
