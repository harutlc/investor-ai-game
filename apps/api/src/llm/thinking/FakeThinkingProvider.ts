import { ProviderBadResponseError } from '../errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../errors/ProviderUnavailableError.js';
import {
  generateJsonWithRetry,
  type JsonRequest,
  type JsonResult,
  type TextResult,
  type ThinkingProvider,
  type ThinkingRequest,
} from './ThinkingProvider.js';

type ScriptedReply = string | Error;

/**
 * Offline provider for tests and UI work. Replies come from a script (FIFO); without one, text requests
 * echo the last user message and JSON requests fail, since no meaningful JSON can be invented.
 */
export class FakeThinkingProvider implements ThinkingProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake';
  readonly requests: ThinkingRequest[] = [];
  private readonly script: ScriptedReply[] = [];
  private healthy = true;

  constructor(script: ScriptedReply[] = []) {
    this.script.push(...script);
  }

  enqueue(...replies: ScriptedReply[]): this {
    this.script.push(...replies);
    return this;
  }

  setHealthy(healthy: boolean): this {
    this.healthy = healthy;
    return this;
  }

  async generateText(request: ThinkingRequest): Promise<TextResult> {
    await Promise.resolve();
    const text = this.next(request) ?? `[fake] ${request.messages.at(-1)?.content ?? ''}`;
    return { text, provider: this.name, model: this.model, latencyMs: 0 };
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const data = await generateJsonWithRetry(request, async (messages) => {
      await Promise.resolve();
      const reply = this.next({ ...request, messages });
      if (reply === undefined)
        throw new ProviderBadResponseError('The fake provider has no scripted JSON reply');
      return reply;
    });
    return { data, provider: this.name, model: this.model, latencyMs: 0 };
  }

  ping(): Promise<void> {
    return this.healthy ? Promise.resolve() : Promise.reject(new ProviderUnavailableError());
  }

  private next(request: ThinkingRequest): string | undefined {
    this.requests.push(request);
    const reply = this.script.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  }
}
