import { Ollama, type Message } from 'ollama';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../../config/AppConfig.js';
import { AppError } from '../../errors/AppError.js';
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

/** Local models through Ollama's `/api/chat`; JSON mode constrains output with a JSON Schema in `format`. */
export class OllamaThinkingProvider implements ThinkingProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly client: Ollama;
  private readonly logger: Logger;

  constructor(
    private readonly settings: OllamaSettings,
    deps: ProviderDeps,
  ) {
    this.model = settings.model;
    this.logger = deps.logger;
    const baseFetch = deps.fetch ?? globalThis.fetch;
    // The client has no timeout option: bound every HTTP attempt here.
    const timedFetch: typeof globalThis.fetch = (input, init) => {
      const timeout = AbortSignal.timeout(settings.timeoutMs);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return baseFetch(input, { ...init, signal });
    };
    this.client = new Ollama({ host: settings.baseUrl, fetch: timedFetch });
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
    const data = await generateJsonWithRetry(request, (messages) =>
      this.chat(request.system, messages, format),
    );
    return {
      data,
      provider: this.name,
      model: this.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async ping(): Promise<void> {
    const { models } = await this.call(() => this.client.list());
    const wanted = new Set([this.model, `${this.model}:latest`]);
    if (!models.some((m) => wanted.has(m.name) || wanted.has(m.model))) {
      this.logger.warn(
        { provider: this.name, model: this.model },
        `Ollama model is not available locally, run: ollama pull ${this.model}`,
      );
      throw new ProviderUnavailableError();
    }
  }

  private async chat(
    system: string | undefined,
    messages: readonly LlmMessage[],
    format?: Record<string, unknown>,
  ): Promise<string> {
    const chatMessages: Message[] = [...(system ? [{ role: 'system', content: system }] : []), ...messages];
    const response = await this.call(() =>
      this.client.chat({
        model: this.model,
        messages: chatMessages,
        stream: false,
        ...(format ? { format } : {}),
        options: { temperature: this.settings.temperature, num_predict: this.settings.maxTokens },
      }),
    );
    return response.message.content;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(this.settings.maxRetries + 1, fn, isRetryable);
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  private toProviderError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    if (isResponseError(error)) {
      this.logger.warn(
        { provider: this.name, status: error.status_code, err: error.message },
        'Ollama request failed',
      );
      return error.status_code >= 500 || error.status_code === 429
        ? new ProviderUnavailableError(undefined, { cause: error })
        : new ProviderBadResponseError(undefined, { cause: error });
    }
    this.logger.warn({ provider: this.name, err: (error as Error).message }, 'Ollama unreachable');
    return new ProviderUnavailableError(undefined, { cause: error });
  }
}
