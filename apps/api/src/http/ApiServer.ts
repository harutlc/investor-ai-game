import type { IncomingMessage, Server } from 'node:http';
import cookieParser from 'cookie-parser';
import express, { Router, type Express, type Request } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from '../config/AppConfig.js';
import type { Controller } from './controllers/Controller.js';
import type { HealthController } from './controllers/HealthController.js';
import { CorsPolicy } from './middleware/CorsPolicy.js';
import type { CsrfProtection } from './middleware/CsrfProtection.js';
import { ErrorHandlerMiddleware } from './middleware/ErrorHandlerMiddleware.js';
import { JsonContentTypeGuard } from './middleware/JsonContentTypeGuard.js';
import { NotFoundMiddleware } from './middleware/NotFoundMiddleware.js';
import type { PlayerSessionMiddleware } from './middleware/PlayerSessionMiddleware.js';
import { RateLimiters } from './middleware/RateLimiters.js';
import { RequestContextMiddleware } from './middleware/RequestContextMiddleware.js';
import { RequestIdMiddleware } from './middleware/RequestIdMiddleware.js';
import { SecurityHeaders } from './middleware/SecurityHeaders.js';

export const API_PREFIX = '/api';

export interface ApiServerDeps {
  config: AppConfig;
  logger: Logger;
  playerSession: PlayerSessionMiddleware;
  /** Omitted when `security.csrf.enabled` is false: no token is required on any request. */
  csrf?: CsrfProtection | undefined;
  health: HealthController;
  /** Feature controllers, mounted under `/api` behind session + CSRF. */
  controllers: Controller[];
}

/**
 * Assembles the Express app. Order matters: cheap rejections (headers, CORS, rate limit) run before any
 * DB work; health is mounted before cookies so probes create no players; the session runs before CSRF
 * because tokens are bound to the player id.
 */
export class ApiServer {
  readonly app: Express;
  private server: Server | undefined;

  constructor(private readonly deps: ApiServerDeps) {
    this.app = this.build();
  }

  private build(): Express {
    const { config, logger, playerSession, csrf, health, controllers } = this.deps;
    const healthPath = `${API_PREFIX}${health.basePath}`;
    const limiters = new RateLimiters(config.security.rateLimit, [healthPath]);
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', config.server.trustProxy);

    app.use(new RequestIdMiddleware().handle);
    app.use(new RequestContextMiddleware().handle);
    app.use(
      pinoHttp({
        logger,
        genReqId: (req: IncomingMessage) => (req as Request).requestId,
        // At most warn: the error handler logs the failure itself at `error`, which is what becomes the Sentry
        // event. An `error` request line would add a second event for the same failure.
        customLogLevel: (_req, res, error) => (error || res.statusCode >= 400 ? 'warn' : 'info'),
      }),
    );
    app.use(SecurityHeaders.create(config.isProduction));
    app.use(CorsPolicy.create(config.cors.origins));
    app.use(limiters.global());

    app.use(healthPath, health.routes());

    app.use(cookieParser(config.secrets.cookieSecret));
    app.use(new JsonContentTypeGuard().handle);
    app.use(express.json({ limit: config.server.bodyLimit, strict: true }));
    app.use(playerSession.handle);
    if (csrf) app.use(csrf.handle);
    app.use(limiters.mutations());

    const api = Router();
    for (const controller of controllers) api.use(controller.basePath, controller.routes());
    app.use(API_PREFIX, api);

    app.use(new NotFoundMiddleware().handle);
    app.use(new ErrorHandlerMiddleware(logger, config.isProduction).handle);
    return app;
  }

  listen(port: number = this.deps.config.server.port): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, (error?: Error) => {
        if (error) reject(error);
        else resolve(server);
      });
      this.server = server;
    });
  }

  /** Stops accepting connections and waits for in-flight requests, up to `timeoutMs`. */
  close(timeoutMs: number = this.deps.config.server.shutdownTimeoutMs): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.closeAllConnections();
        reject(new Error(`Shutdown timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref();
      server.close((error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
      server.closeIdleConnections();
    });
  }
}
