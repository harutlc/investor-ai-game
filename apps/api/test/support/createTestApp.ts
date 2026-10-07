import { pino, type Logger } from 'pino';
import { Container } from '../../src/container/Container.js';
import type { Controller } from '../../src/http/controllers/Controller.js';
import type { DecisionProvider } from '../../src/llm/decision/DecisionProvider.js';
import type { ThinkingProvider } from '../../src/llm/thinking/ThinkingProvider.js';
import type { Clock } from '../../src/services/PlayerService.js';
import { testConfig } from './testConfig.js';

/** The full production wiring with an in-memory database, fixed secrets and a silent logger. */
export function createTestApp(
  options: Parameters<typeof testConfig>[0] & {
    clock?: Clock;
    extraControllers?: Controller[];
    thinkingProvider?: ThinkingProvider;
    decisionProvider?: DecisionProvider;
    logger?: Logger;
  } = {},
) {
  const { clock, extraControllers, thinkingProvider, decisionProvider, logger, ...configOverrides } = options;
  // Fake providers by default (testConfig selects "fake"), so tests never touch the network.
  const container = new Container(testConfig(configOverrides), {
    logger: logger ?? pino({ level: 'silent' }),
    ...(clock ? { clock } : {}),
    ...(extraControllers ? { extraControllers } : {}),
    ...(thinkingProvider ? { thinkingProvider } : {}),
    ...(decisionProvider ? { decisionProvider } : {}),
  });
  return { container, app: container.server.app, players: container.playerRepository };
}
