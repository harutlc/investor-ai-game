import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/AppConfig.js';
import { AppError } from '../../errors/AppError.js';
import { LlmCallLogger, type LlmCallMeta, type LlmResponseInfo } from '../../logging/LlmCallLogger.js';
import { LlmPricing } from '../../logging/LlmPricing.js';
import { ReportedErrors } from '../../monitoring/ReportedErrors.js';
import { ProviderBadResponseError } from '../errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../errors/ProviderUnavailableError.js';
import type { ProviderDeps } from '../ProviderDeps.js';
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

type AnthropicSettings = AppConfig['llm']['thinking']['providers']['anthropic'];

/** Server-side refusal fallback, `fallbacks: "default"` form (the array form uses the -06-01 header). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const PING_TIMEOUT_MS = 3000;

/*
 * SDK surface (@anthropic-ai/sdk 0.131, checked when this provider was written):
 * - `client.beta.messages.create/parse` both exist; `fallbacks: 'default'` and the beta name are typed.
 * - `betaZodOutputFormat(schema)` (helpers/beta/zod) yields `{ type: 'json_schema', schema, parse }`.
 *   `messages.parse` throws when the output fails the zod schema, which loses the raw text the shared
 *   retry needs. So JSON mode sends the SDK-transformed `{ type, schema }` through `create` (same output
 *   constraint) and validates with JsonResponseParser like every other provider.
 * - Current models reject `temperature`; depth/cost is `output_config.effort`. No sampling params here.
 * - Accepts an injectable `fetch`, `timeout` (ms) and `maxRetries` (retries 408/409/429/5xx/connection).
 *   The SDK calls `fetch` once per attempt, which is how LlmCallLogger sees retries, 429s and timeouts.
 * - Every call goes through `LlmCallLogger.run`, so no call site logs (or forgets to log) on its own.
 */
export class AnthropicThinkingProvider implements ThinkingProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly logger: Logger;
  private readonly calls: LlmCallLogger;

  constructor(
    private readonly settings: AnthropicSettings,
    apiKey: string,
    deps: ProviderDeps,
  ) {
    this.model = settings.model;
    this.logger = deps.logger;
    // Hand-built providers (tests, scripts) get a logger without prices; the container passes the shared one.
    this.calls =
      deps.llmCalls ??
      new LlmCallLogger({ logger: deps.logger, pricing: new LlmPricing({}, deps.logger), logContent: false });
    const fetch = deps.fetch;
    this.client = new Anthropic({
      apiKey,
      timeout: settings.timeoutMs,
      maxRetries: settings.maxRetries,
      fetch: this.calls.instrumentFetch((input, init) => (fetch ?? globalThis.fetch)(input, init)),
    });
  }

  async generateText(request: ThinkingRequest): Promise<TextResult> {
    const started = performance.now();
    const text = requireText(await this.complete(request.system, request.messages));
    return {
      text,
      provider: this.name,
      model: this.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const started = performance.now();
    const { type, schema } = betaZodOutputFormat(request.schema);
    const data = await generateJsonWithRetry(
      request,
      (messages) => this.complete(request.system, messages, { type, schema }),
      (reason) => this.calls.retry(this.meta(request.system, request.messages), 2, reason),
    );
    return {
      data,
      provider: this.name,
      model: this.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  /** Retrieving the model checks both the key and the model id without spending tokens. */
  async ping(): Promise<void> {
    const meta: LlmCallMeta = {
      provider: this.name,
      operation: 'ping',
      model: this.model,
      timeoutMs: PING_TIMEOUT_MS,
    };
    try {
      await this.calls.run(
        meta,
        () => this.client.models.retrieve(this.model, {}, { timeout: PING_TIMEOUT_MS, maxRetries: 0 }),
        () => ({}),
      );
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  private async complete(
    system: string | undefined,
    messages: readonly LlmMessage[],
    format?: Anthropic.Beta.BetaJSONOutputFormat,
  ): Promise<string> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.calls.run(
        this.meta(system, messages),
        () =>
          this.client.beta.messages.create({
            model: this.model,
            max_tokens: this.settings.maxTokens,
            ...(system ? { system } : {}),
            messages: messages.map(({ role, content }) => ({ role, content })),
            output_config: { effort: this.settings.effort, ...(format ? { format } : {}) },
            ...(this.settings.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
          }),
        (message) => AnthropicThinkingProvider.describe(message),
      );
    } catch (error) {
      throw this.toProviderError(error);
    }

    // A decline arrives as HTTP 200; with fallbacks on, this means the whole fallback chain declined.
    // LlmCallLogger has already logged (and reported) it as a failed call.
    if (response.stop_reason === 'refusal') {
      const error = new ProviderBadResponseError('The AI provider declined the request');
      ReportedErrors.mark(error);
      throw error;
    }
    return AnthropicThinkingProvider.textOf(response);
  }

  private meta(system: string | undefined, messages: readonly LlmMessage[]): LlmCallMeta {
    return {
      provider: this.name,
      operation: 'generate',
      model: this.model,
      maxTokens: this.settings.maxTokens,
      temperature: null,
      effort: this.settings.effort,
      fallbacks: this.settings.fallbacks,
      timeoutMs: this.settings.timeoutMs,
      prompt: { system, messages },
    };
  }

  private static describe(
    message: Anthropic.Beta.BetaMessage & { _request_id?: string | null },
  ): LlmResponseInfo {
    const { usage } = message;
    return {
      model: message.model,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: message.stop_reason,
      anthropicRequestId: message._request_id ?? null,
      text: AnthropicThinkingProvider.textOf(message),
      ...(message.stop_reason === 'refusal'
        ? { refusal: { category: message.stop_details?.category ?? null } }
        : {}),
    };
  }

  private static textOf(message: Anthropic.Beta.BetaMessage): string {
    return message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  private toProviderError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    // LlmCallLogger has logged the failure (llm.call_failed); this only maps it to the API's error codes.
    if (error instanceof Anthropic.APIConnectionError) {
      return new ProviderUnavailableError(undefined, { cause: error });
    }
    if (error instanceof Anthropic.APIError) {
      // APIError's generic defaults type these as `any`; pin them.
      const status: number | undefined = error.status as number | undefined;
      if (status === 401 || status === 403) {
        // A hint for operators next to the llm.call_failed line, not a second report.
        this.logger.warn(
          { provider: this.name, status },
          'Anthropic rejected the credentials, check ANTHROPIC_API_KEY',
        );
        return new ProviderUnavailableError(undefined, { cause: error });
      }
      return status !== undefined && (status === 429 || status >= 500)
        ? new ProviderUnavailableError(undefined, { cause: error })
        : new ProviderBadResponseError(undefined, { cause: error });
    }
    return error;
  }
}
