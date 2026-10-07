import { Ollama, type ChatResponse, type Message } from 'ollama';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../../config/AppConfig.js';
import { AppError } from '../../errors/AppError.js';
import { LlmCallLogger, type LlmCallMeta, type LlmResponseInfo } from '../../logging/LlmCallLogger.js';
import { LlmPricing } from '../../logging/LlmPricing.js';
import { ProviderBadResponseError } from '../errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../errors/ProviderUnavailableError.js';
import type { ProviderDeps } from '../ProviderDeps.js';
import { withRetry } from '../withRetry.js';
import {
  generateJsonWithRetry,
  requireText,
  type JsonRequest,
  type JsonResult,
  type LlmMessage,
  type TextResult,
  type ThinkingProvider,
  type ThinkingRequest,
} from './ThinkingProvider.js';

type OllamaSettings = AppConfig['llm']['thinking']['providers']['ollama'];

/** The `ollama` client throws `ResponseError` (not exported in its types) for non-2xx answers. */
interface OllamaResponseError {
  name: 'ResponseError';
  status_code: number;
  message: string;
}

function isResponseError(error: unknown): error is OllamaResponseError {
  return error instanceof Error && error.name === 'ResponseError' && 'status_code' in error;
}

/** Network failure, our per-attempt timeout, or an abort. */
function isTransportError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}

function isRetryable(error: unknown): boolean {
  if (isTransportError(error)) return true;
  return isResponseError(error) && (error.status_code >= 500 || error.status_code === 429);
}

/**
 * Local models through Ollama's `/api/chat`; JSON mode constrains output with a JSON Schema in `format`.
 * Every call goes through `LlmCallLogger.run`, and each HTTP attempt (including `withRetry`'s) through the
 * instrumented `fetch`, so nothing here logs a call on its own. Local models are not priced.
 */
export class OllamaThinkingProvider implements ThinkingProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly client: Ollama;
  private readonly logger: Logger;
  private readonly calls: LlmCallLogger;

  constructor(
    private readonly settings: OllamaSettings,
    deps: ProviderDeps,
  ) {
    this.model = settings.model;
    this.logger = deps.logger;
    // Hand-built providers (tests, scripts) get their own call logger; the container passes the shared one.
    this.calls =
      deps.llmCalls ??
      new LlmCallLogger({ logger: deps.logger, pricing: new LlmPricing({}, deps.logger), logContent: false });
    const baseFetch = deps.fetch ?? globalThis.fetch;
    // The client has no timeout option: bound every HTTP attempt here.
    const timedFetch: typeof globalThis.fetch = (input, init) => {
      const timeout = AbortSignal.timeout(settings.timeoutMs);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return baseFetch(input, { ...init, signal });
    };
    // Instrumented outside the timeout, so a timed-out attempt is seen (as a TimeoutError).
    this.client = new Ollama({ host: settings.baseUrl, fetch: this.calls.instrumentFetch(timedFetch) });
  }

  async generateText(request: ThinkingRequest): Promise<TextResult> {
    const started = performance.now();
    const text = requireText(await this.chat(request.system, request.messages));
    return {
      text,
      provider: this.name,
      model: this.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const started = performance.now();
    const format = z.toJSONSchema(request.schema) as Record<string, unknown>;
    const data = await generateJsonWithRetry(
      request,
      (messages) => this.chat(request.system, messages, format),
      (reason) => this.calls.retry(this.meta(request.system, request.messages), 2, reason),
    );
    return {
      data,
      provider: this.name,
      model: this.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async ping(): Promise<void> {
    const meta: LlmCallMeta = {
      provider: this.name,
      operation: 'ping',
      model: this.model,
      priced: false,
      timeoutMs: this.settings.timeoutMs,
    };
    await this.call(
      meta,
      async () => {
        const { models } = await this.client.list();
        const wanted = new Set([this.model, `${this.model}:latest`]);
        if (!models.some((m) => wanted.has(m.name) || wanted.has(m.model))) {
          this.logger.warn(
            { provider: this.name, model: this.model },
            `Ollama model is not available locally, run: ollama pull ${this.model}`,
          );
          throw new ProviderUnavailableError();
        }
      },
      () => ({}),
    );
  }

  private async chat(
    system: string | undefined,
    messages: readonly LlmMessage[],
    format?: Record<string, unknown>,
  ): Promise<string> {
    const chatMessages: Message[] = [...(system ? [{ role: 'system', content: system }] : []), ...messages];
    const response = await this.call(
      this.meta(system, messages),
      () =>
        this.client.chat({
          model: this.model,
          messages: chatMessages,
          stream: false,
          ...(format ? { format } : {}),
          options: { temperature: this.settings.temperature, num_predict: this.settings.maxTokens },
        }),
      (chat) => OllamaThinkingProvider.describe(chat),
    );
    return response.message.content;
  }

  /** One logged call: `withRetry`'s attempts all happen inside it. */
  private async call<T>(
    meta: LlmCallMeta,
    fn: () => Promise<T>,
    describe: (result: T) => LlmResponseInfo,
  ): Promise<T> {
    try {
      return await this.calls.run(
        meta,
        () => withRetry(this.settings.maxRetries + 1, fn, isRetryable),
        describe,
      );
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  private meta(system: string | undefined, messages: readonly LlmMessage[]): LlmCallMeta {
    return {
      provider: this.name,
      operation: 'generate',
      model: this.model,
      priced: false,
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
      timeoutMs: this.settings.timeoutMs,
      prompt: { system, messages },
    };
  }

  private static describe(response: ChatResponse): LlmResponseInfo {
    return {
      model: response.model,
      usage: {
        // Ollama omits the prompt count when the prompt was fully cached.
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      stopReason: response.done_reason ?? null,
      text: response.message.content,
    };
  }

  /** LlmCallLogger has logged the failure (llm.call_failed); this only maps it to the API's error codes. */
  private toProviderError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    if (isResponseError(error)) {
      return error.status_code >= 500 || error.status_code === 429
        ? new ProviderUnavailableError(undefined, { cause: error })
        : new ProviderBadResponseError(undefined, { cause: error });
    }
    return new ProviderUnavailableError(undefined, { cause: error });
  }
}
