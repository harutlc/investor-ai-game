import { pino } from 'pino';
import { Container } from '../../src/container/Container.js';
import type { Controller } from '../../src/http/controllers/Controller.js';
import type { Clock } from '../../src/services/PlayerService.js';
import { testConfig } from './testConfig.js';

/** The full production wiring with an in-memory database, fixed secrets and a silent logger. */
export function createTestApp(
  options: Parameters<typeof testConfig>[0] & { clock?: Clock; extraControllers?: Controller[] } = {},
) {
  const { clock, extraControllers, ...configOverrides } = options;
  const container = new Container(testConfig(configOverrides), {
    logger: pino({ level: 'silent' }),
    ...(clock ? { clock } : {}),
    ...(extraControllers ? { extraControllers } : {}),
  });
  return { container, app: container.server.app, players: container.playerRepository };
}
