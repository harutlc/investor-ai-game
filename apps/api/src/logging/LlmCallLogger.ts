import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import type { LlmMessage } from '../llm/thinking/ThinkingProvider.js';
import { ReportedErrors } from '../monitoring/ReportedErrors.js';
import type { LlmPricing, LlmUsage } from './LlmPricing.js';

export interface LlmCallMeta {
  provider: string;
  /** `ping` is the reachability check; its successes log at debug (health probes run on a timer). */
  operation: 'generate' | 'ping';
  model: string;
  maxTokens?: number;
  /** `null` when the request sends none. */
  temperature?: number | null;
  effort?: string;
  fallbacks?: boolean;
  /** Per-attempt timeout, reported on `llm.timeout`. */
  timeoutMs: number;
  /** Logged only when `LOG_LLM_CONTENT` is on. */
  prompt?: { system?: string | undefined; messages: readonly LlmMessage[] };
}

export interface LlmResponseInfo {
  /** The model that served the response (differs from the requested one after a fallback). */
  model?: string;
  usage?: LlmUsage;
  stopReason?: string | null;
  anthropicRequestId?: string | null;
  /** Logged only when `LOG_LLM_CONTENT` is on. */
  text?: string;
  /** A decline that arrived as a successful response: logged as a failed call. */
  refusal?: { category: string | null };
}

export interface LlmCallLoggerOptions {
  logger: Logger;
  pricing: LlmPricing;
  /** Include prompts and responses (`LOG_LLM_CONTENT`). */
  logContent: boolean;
}

/** One frame per call: how many HTTP attempts it made and how the last one ended. */
interface CallFrame {
  meta: LlmCallMeta;
  attempts: number;
  lastOutcome: string | undefined;
}

/**
 * Structured logging for every LLM call, so call sites log nothing themselves. `run` wraps one call and
 * writes `llm.call` (success) or `llm.call_failed`; `instrumentFetch` sees each HTTP attempt inside it,
 * including the SDK's own retries, and writes `llm.retry`, `llm.rate_limited`, `llm.overloaded` and
 * `llm.timeout`. All lines go through the application logger: redaction, request id and Sentry apply.
 */
export class LlmCallLogger {
  private readonly frames = new AsyncLocalStorage<CallFrame>();
  private readonly logger: Logger;

  constructor(private readonly options: LlmCallLoggerOptions) {
    this.logger = options.logger;
  }

  async run<T>(
    meta: LlmCallMeta,
    call: () => Promise<T>,
    describe: (result: T) => LlmResponseInfo,
  ): Promise<T> {
    const frame: CallFrame = { meta, attempts: 0, lastOutcome: undefined };
    const started = performance.now();
    let result: T;
    try {
      result = await this.frames.run(frame, call);
    } catch (error) {
      if (!ReportedErrors.has(error)) this.failed(frame, started, error);
      throw error;
    }
    this.succeeded(frame, started, describe(result));
    return result;
  }

  /** Logs the application retrying a call, e.g. after output that failed the JSON schema. */
  retry(meta: LlmCallMeta, attempt: number, reason: string): void {
    this.logger.warn({ ...this.base(meta), event: 'llm.retry', attempt, reason }, 'llm.retry');
  }

  /** A `fetch` that reports every attempt of the call it runs under; outside a call it just passes through. */
  instrumentFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
    return async (input, init) => {
      const frame = this.frames.getStore();
      if (!frame) return fetch(input, init);
      const attempt = ++frame.attempts;
      if (attempt > 1) {
        this.logger.warn(
          { ...this.base(frame.meta), event: 'llm.retry', attempt, reason: frame.lastOutcome ?? 'unknown' },
          'llm.retry',
        );
      }
      let response: Response;
      try {
        response = await fetch(input, init);
      } catch (error) {
        frame.lastOutcome = this.isTimeout(error, init) ? 'timeout' : 'connection';
        if (frame.lastOutcome === 'timeout') {
          this.logger.warn(
            { ...this.base(frame.meta), event: 'llm.timeout', attempt, timeoutMs: frame.meta.timeoutMs },
            'llm.timeout',
          );
        }
        throw error;
      }
      frame.lastOutcome = this.outcome(response.status);
      if (response.status === 429 || response.status === 529) {
        const event = response.status === 429 ? 'llm.rate_limited' : 'llm.overloaded';
        this.logger.warn(
          {
            ...this.base(frame.meta),
            event,
            attempt,
            status: response.status,
            ...LlmCallLogger.retryAfter(response.headers),
            anthropicRequestId: response.headers.get('request-id'),
          },
          event,
        );
      }
      return response;
    };
  }

  private succeeded(frame: CallFrame, started: number, info: LlmResponseInfo): void {
    const { meta } = frame;
    const model = info.model ?? meta.model;
    const usage = info.usage
      ? {
          ...info.usage,
          totalTokens:
            info.usage.inputTokens +
            info.usage.outputTokens +
            info.usage.cacheReadInputTokens +
            info.usage.cacheCreationInputTokens,
        }
      : undefined;
    const fields = {
      ...this.base(meta),
      model,
      ...(model === meta.model ? {} : { requestedModel: meta.model }),
      ...this.params(meta),
      ...(usage ? { usage, costUsd: this.options.pricing.estimate(model, info.usage!) } : {}),
      latencyMs: LlmCallLogger.since(started),
      attempts: Math.max(1, frame.attempts),
      ...(info.stopReason === undefined ? {} : { stopReason: info.stopReason }),
      ...(info.anthropicRequestId === undefined ? {} : { anthropicRequestId: info.anthropicRequestId }),
      ...this.content(meta, info.text),
    };
    if (info.refusal) {
      this.logger.error(
        {
          ...fields,
          event: 'llm.call_failed',
          errorType: 'Refusal',
          status: null,
          category: info.refusal.category,
        },
        'llm.call_failed',
      );
      return;
    }
    const level = meta.operation === 'ping' ? 'debug' : 'info';
    this.logger[level]({ ...fields, event: 'llm.call' }, 'llm.call');
  }

  private failed(frame: CallFrame, started: number, error: unknown): void {
    const { meta } = frame;
    const status = (error as { status?: unknown } | null)?.status;
    const requestId = (error as { requestID?: unknown } | null)?.requestID;
    this.logger.error(
      {
        ...this.base(meta),
        event: 'llm.call_failed',
        ...this.params(meta),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        status: typeof status === 'number' ? status : null,
        attempts: Math.max(1, frame.attempts),
        latencyMs: LlmCallLogger.since(started),
        anthropicRequestId: typeof requestId === 'string' ? requestId : null,
        ...this.content(meta),
        err: error,
      },
      'llm.call_failed',
    );
    ReportedErrors.mark(error);
  }

  private base(meta: LlmCallMeta) {
    return { provider: meta.provider, operation: meta.operation, model: meta.model };
  }

  private params(meta: LlmCallMeta) {
    if (meta.operation === 'ping') return {};
    return {
      maxTokens: meta.maxTokens,
      temperature: meta.temperature ?? null,
      ...(meta.effort === undefined ? {} : { effort: meta.effort }),
      ...(meta.fallbacks === undefined ? {} : { fallbacks: meta.fallbacks }),
    };
  }

  private content(meta: LlmCallMeta, text?: string) {
    if (!this.options.logContent || !meta.prompt) return {};
    return {
      prompt: { system: meta.prompt.system, messages: meta.prompt.messages },
      ...(text === undefined ? {} : { response: { text } }),
    };
  }

  private outcome(status: number): string | undefined {
    if (status === 429 || status === 529 || status === 408 || status === 409 || status >= 500)
      return `status_${status}`;
    return undefined;
  }

  /** The SDK aborts its own controller on timeout; this app never passes a caller abort signal. */
  private isTimeout(error: unknown, init: RequestInit | undefined): boolean {
    return (error instanceof Error && error.name === 'AbortError') || init?.signal?.aborted === true;
  }

  /** `retry-after-ms` (milliseconds) or `retry-after` (seconds or an HTTP date), as both units. */
  private static retryAfter(headers: Headers): {
    retryAfterSeconds: number | null;
    retryAfterMs: number | null;
  } {
    const millis = Number.parseFloat(headers.get('retry-after-ms') ?? '');
    if (Number.isFinite(millis)) return { retryAfterSeconds: millis / 1000, retryAfterMs: millis };
    const raw = headers.get('retry-after');
    if (raw !== null) {
      const seconds = Number.parseFloat(raw);
      if (Number.isFinite(seconds)) return { retryAfterSeconds: seconds, retryAfterMs: seconds * 1000 };
      const date = Date.parse(raw);
      if (Number.isFinite(date)) {
        const ms = Math.max(0, date - Date.now());
        return { retryAfterSeconds: ms / 1000, retryAfterMs: ms };
      }
    }
    return { retryAfterSeconds: null, retryAfterMs: null };
  }

  private static since(started: number): number {
    return Math.round(performance.now() - started);
  }
}
