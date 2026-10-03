import type { z } from 'zod';
import type { THINKING_PROVIDERS } from '../../config/AppConfigSchema.js';
import { ProviderBadResponseError } from '../errors/ProviderBadResponseError.js';
import { JsonResponseParser } from '../JsonResponseParser.js';

export type ThinkingProviderName = (typeof THINKING_PROVIDERS)[number];

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ThinkingRequest {
  system?: string | undefined;
  messages: readonly LlmMessage[];
}

export interface JsonRequest<T> extends ThinkingRequest {
  schema: z.ZodType<T>;
}

interface ResultMeta {
  provider: ThinkingProviderName;
  model: string;
  latencyMs: number;
}

export interface TextResult extends ResultMeta {
  text: string;
}

export interface JsonResult<T> extends ResultMeta {
  data: T;
}

/**
 * The "thinking" LLM, the investor's voice: free text and schema-validated JSON. Sampling settings
 * (temperature, effort) live in each provider's config, not in requests: some backends reject them.
 */
export interface ThinkingProvider {
  readonly name: ThinkingProviderName;
  readonly model: string;
  generateText(request: ThinkingRequest): Promise<TextResult>;
  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
  /** Resolves when the backend answers and the configured model is available; throws otherwise. */
  ping(): Promise<void>;
}

/**
 * Shared JSON flow: ask once; if the reply is not valid JSON for `schema`, show the model its reply and
 * the problems, ask once more; a second failure is a bad response.
 */
export async function generateJsonWithRetry<T>(
  request: JsonRequest<T>,
  complete: (messages: readonly LlmMessage[]) => Promise<string>,
): Promise<T> {
  const first = await complete(request.messages);
  const firstResult = JsonResponseParser.parse(first, request.schema);
  if (firstResult.ok) return firstResult.data;

  const retryMessages: LlmMessage[] = [
    ...request.messages,
    { role: 'assistant', content: first.trim() || '(empty reply)' },
    {
      role: 'user',
      content: `Your previous reply was invalid: ${firstResult.issues}. Reply again with only the JSON value, matching the required schema exactly.`,
    },
  ];
  const second = JsonResponseParser.parse(await complete(retryMessages), request.schema);
  if (second.ok) return second.data;
  throw new ProviderBadResponseError('The AI provider returned invalid JSON', {
    cause: new Error(second.issues),
  });
}

/** Trims a text reply; an empty reply is a bad response. */
export function requireText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new ProviderBadResponseError('The AI provider returned an empty reply');
  return trimmed;
}
