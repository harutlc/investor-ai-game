import { pino, type Logger } from 'pino';
import { Container } from '../../src/container/Container.js';
import type { Database } from '../../src/db/Database.js';
import type { Controller } from '../../src/http/controllers/Controller.js';
import type { DecisionProvider } from '../../src/llm/decision/DecisionProvider.js';
import type { ThinkingProvider } from '../../src/llm/thinking/ThinkingProvider.js';
import type { Clock } from '../../src/services/PlayerService.js';
import { testConfig } from './testConfig.js';

/**
 * The full production wiring with an in-memory SQLite database (or `database`), fixed secrets and a silent
 * logger. Dispose the container to close the database.
 */
export async function createTestApp(
  options: Parameters<typeof testConfig>[0] & {
    database?: Database;
    clock?: Clock;
    extraControllers?: Controller[];
    thinkingProvider?: ThinkingProvider;
    decisionProvider?: DecisionProvider;
    logger?: Logger;
  } = {},
) {
  const {
    database,
    clock,
    extraControllers,
    thinkingProvider,
    decisionProvider,
    logger,
    ...configOverrides
  } = options;
  // Fake providers by default (testConfig selects "fake"), so tests never touch the network.
  const container = await Container.create(testConfig(configOverrides), {
    logger: logger ?? pino({ level: 'silent' }),
    ...(database ? { database } : {}),
    ...(clock ? { clock } : {}),
    ...(extraControllers ? { extraControllers } : {}),
    ...(thinkingProvider ? { thinkingProvider } : {}),
    ...(decisionProvider ? { decisionProvider } : {}),
  });
  return { container, app: container.server.app, players: container.playerRepository };
}
