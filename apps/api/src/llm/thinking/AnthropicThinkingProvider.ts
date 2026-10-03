import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/AppConfig.js';
import { AppError } from '../../errors/AppError.js';
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
 */
export class AnthropicThinkingProvider implements ThinkingProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly logger: Logger;

  constructor(
    private readonly settings: AnthropicSettings,
    apiKey: string,
    deps: ProviderDeps,
  ) {
    this.model = settings.model;
    this.logger = deps.logger;
    this.client = new Anthropic({
      apiKey,
      timeout: settings.timeoutMs,
      maxRetries: settings.maxRetries,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
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
    const data = await generateJsonWithRetry(request, (messages) =>
      this.complete(request.system, messages, { type, schema }),
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
    try {
      await this.client.models.retrieve(this.model, {}, { timeout: PING_TIMEOUT_MS, maxRetries: 0 });
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
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: this.settings.maxTokens,
        ...(system ? { system } : {}),
        messages: messages.map(({ role, content }) => ({ role, content })),
        output_config: { effort: this.settings.effort, ...(format ? { format } : {}) },
        ...(this.settings.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      });
    } catch (error) {
      throw this.toProviderError(error);
    }

    // A decline arrives as HTTP 200; with fallbacks on, this means the whole fallback chain declined.
    if (response.stop_reason === 'refusal') {
      this.logger.warn(
        { provider: this.name, model: response.model, category: response.stop_details?.category ?? null },
        'Anthropic declined the request',
      );
      throw new ProviderBadResponseError('The AI provider declined the request');
    }
    return response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  private toProviderError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    if (error instanceof Anthropic.APIConnectionError) {
      this.logger.warn({ provider: this.name, err: error.message }, 'Anthropic unreachable');
      return new ProviderUnavailableError(undefined, { cause: error });
    }
    if (error instanceof Anthropic.APIError) {
      // APIError's generic defaults type these as `any`; pin them.
      const status: number | undefined = error.status as number | undefined;
      const requestId: string | null | undefined = error.requestID;
      const context = { provider: this.name, status, requestId };
      if (status === 401 || status === 403) {
        this.logger.error(context, 'Anthropic rejected the credentials, check ANTHROPIC_API_KEY');
        return new ProviderUnavailableError(undefined, { cause: error });
      }
      this.logger.warn({ ...context, err: error.message }, 'Anthropic request failed');
      return status !== undefined && (status === 429 || status >= 500)
        ? new ProviderUnavailableError(undefined, { cause: error })
        : new ProviderBadResponseError(undefined, { cause: error });
    }
    return error;
  }
}
