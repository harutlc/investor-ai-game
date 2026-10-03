import type { Logger } from 'pino';

/** Collaborators every real provider receives. `fetch` is injectable so tests never touch the network. */
export interface ProviderDeps {
  logger: Logger;
  fetch?: typeof globalThis.fetch;
}
