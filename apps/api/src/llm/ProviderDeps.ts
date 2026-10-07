import type { Logger } from 'pino';
import type { LlmCallLogger } from '../logging/LlmCallLogger.js';

/** Collaborators every real provider receives. `fetch` is injectable so tests never touch the network. */
export interface ProviderDeps {
  logger: Logger;
  fetch?: typeof globalThis.fetch;
  /** Structured per-call logging (usage, cost, retries). The container always passes the shared one. */
  llmCalls?: LlmCallLogger;
}
