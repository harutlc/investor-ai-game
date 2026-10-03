import express, { type RequestHandler, type Router } from 'express';
import { pino } from 'pino';
import { ErrorHandlerMiddleware } from '../../src/http/middleware/ErrorHandlerMiddleware.js';
import { JsonContentTypeGuard } from '../../src/http/middleware/JsonContentTypeGuard.js';
import { NotFoundMiddleware } from '../../src/http/middleware/NotFoundMiddleware.js';
import { RequestIdMiddleware } from '../../src/http/middleware/RequestIdMiddleware.js';

interface MiniAppOptions {
  isProduction?: boolean;
  /** Middleware mounted after the request id and before body parsing. */
  before?: RequestHandler[];
  trustProxy?: false | number;
  bodyLimit?: string;
}

/** A minimal app with the core middleware around `router`, for testing middleware in isolation. */
export function miniApp(router: Router, options: MiniAppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? false);
  app.use(new RequestIdMiddleware().handle);
  for (const handler of options.before ?? []) app.use(handler);
  app.use(new JsonContentTypeGuard().handle);
  app.use(express.json({ limit: options.bodyLimit ?? '100kb', strict: true }));
  app.use(router);
  app.use(new NotFoundMiddleware().handle);
  app.use(new ErrorHandlerMiddleware(pino({ level: 'silent' }), options.isProduction ?? false).handle);
  return app;
}
