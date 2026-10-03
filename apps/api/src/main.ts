import { ConfigError } from './config/ConfigError.js';
import { ConfigLoader } from './config/ConfigLoader.js';
import { WorkspaceRoot } from './config/WorkspaceRoot.js';
import { Container } from './container/Container.js';

function loadConfig() {
  try {
    return new ConfigLoader({ rootDir: WorkspaceRoot.find() }).load();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const container = new Container(config);
  const { logger, server } = container;

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    server
      .close()
      .then(() => {
        container.dispose();
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        container.dispose();
        process.exit(1);
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await server.listen();
  logger.info({ port: config.server.port, env: config.nodeEnv }, 'API listening');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
