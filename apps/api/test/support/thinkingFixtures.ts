import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import type {
  JsonRequest,
  JsonResult,
  TextResult,
  ThinkingProvider,
  ThinkingRequest,
} from '../../src/llm/thinking/ThinkingProvider.js';

/**
 * Scripted voice: text requests (lines) and JSON requests (options) are answered from separate queues, so
 * tests do not depend on which of the two concurrent calls runs first. `gate` can hold each call.
 */
export class ScriptedThinkingProvider implements ThinkingProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake';
  readonly text = new FakeThinkingProvider();
  readonly json = new FakeThinkingProvider();

  constructor(
    textReplies: (string | Error)[] = [],
    jsonReplies: (string | Error)[] = [],
    private readonly gate: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.text.enqueue(...textReplies);
    this.json.enqueue(...jsonReplies);
  }

  async generateText(request: ThinkingRequest): Promise<TextResult> {
    await this.gate();
    return this.text.generateText(request);
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    await this.gate();
    return this.json.generateJson(request);
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A thinking provider that is always down, so the voice uses its code-written lines and options. Makes
 * engine tests deterministic without scripting every line.
 */
export class UnavailableThinkingProvider implements ThinkingProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake';
  calls = 0;

  generateText(): Promise<TextResult> {
    this.calls++;
    return Promise.reject(new ProviderUnavailableError());
  }

  generateJson<T>(): Promise<JsonResult<T>> {
    this.calls++;
    return Promise.reject(new ProviderUnavailableError());
  }

  ping(): Promise<void> {
    return Promise.reject(new ProviderUnavailableError());
  }
}
