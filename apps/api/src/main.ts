import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';
import type { AppConfig } from './config/AppConfig.js';
import { ConfigError } from './config/ConfigError.js';
import { ConfigLoader } from './config/ConfigLoader.js';
import { WorkspaceRoot } from './config/WorkspaceRoot.js';
import { Container } from './container/Container.js';
import { DatabaseConnectionError } from './db/DatabaseConnectionError.js';
import { LoggerFactory } from './logging/LoggerFactory.js';

/** The bootstrap logger until the container's logger exists. */
let logger: Logger = LoggerFactory.bootstrap();

/** Flushes Sentry (fatal lines become events) before exiting, so the last event is not lost. */
function exitAfterFlush(code: number): void {
  void Sentry.flush(2000).finally(() => process.exit(code));
}

function loadConfig(): AppConfig | undefined {
  try {
    return new ConfigLoader({ rootDir: WorkspaceRoot.find() }).load();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.fatal({ issues: error.issues }, error.message);
      return undefined;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    exitAfterFlush(1);
    return;
  }
  let container: Container;
  try {
    container = await Container.create(config);
  } catch (error) {
    if (error instanceof DatabaseConnectionError) {
      // The message names the dialect and host only; the connection string never reaches the logs.
      logger.fatal({ dialect: error.dialect, host: error.host }, error.message);
      exitAfterFlush(1);
      return;
    }
    throw error;
  }
  const { server } = container;
  logger = container.logger;

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    exitAfterFlush(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    exitAfterFlush(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    server
      .close()
      .then(async () => {
        await container.dispose();
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch(async (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        await container.dispose().catch(() => undefined);
        process.exit(1);
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await server.listen();
  logger.info({ port: config.server.port, env: config.nodeEnv }, 'API listening');
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'startup failed');
  exitAfterFlush(1);
});
