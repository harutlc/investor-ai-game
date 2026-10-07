import * as Sentry from '@sentry/node';

type Env = Record<string, string | undefined>;
type SentryLog = Parameters<NonNullable<Sentry.NodeOptions['beforeSendLog']>>[0];

const HEALTH_PATH = '/api/health';

/** LLM log fields that may hold player text (see LlmCallLogger); never sent to Sentry from production. */
const CONTENT_ATTRIBUTES = ['prompt', 'response'] as const;

/**
 * Sentry options for the API, kept apart from `instrument.ts` so tests can initialise Sentry the same way.
 *
 * Logs: SDK v11 has no `enableLogs` option, Sentry Logs are always on. If the SDK is ever pinned back to
 * the 10.x line (>= 10.18.0 for `pinoIntegration`), add `enableLogs: true` here.
 */
export class SentryOptions {
  static build(env: Env): Sentry.NodeOptions {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    return {
      // Unset DSN disables the SDK, so local runs and tests without one send nothing.
      dsn: env.SENTRY_DSN || undefined,
      environment: env.SENTRY_ENVIRONMENT || nodeEnv,
      release: env.SENTRY_RELEASE || undefined,
      dataCollection: {
        // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
        // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
        // userInfo: false,
        // httpBodies: [],
      },
      // 100% in development, lower in production.
      tracesSampleRate: nodeEnv === 'development' ? 1.0 : 0.1,
      // Capture local variable values in stack frames.
      includeLocalVariables: true,
      integrations: [
        // Pino lines become Sentry Logs (info/warn/error) and error events (error/fatal). Pino 10 publishes
        // the `pino_asJson` diagnostics channel, so every logger is covered whatever the import order.
        Sentry.pinoIntegration({
          log: { levels: ['info', 'warn', 'error'] },
          error: { levels: ['error', 'fatal'], handled: true },
        }),
      ],
      beforeSendLog: (log) => SentryOptions.beforeSendLog(log, isProduction),
    };
  }

  /** Drops health-probe request lines, and LLM prompt/response content in production. */
  static beforeSendLog(log: SentryLog, isProduction: boolean): SentryLog | null {
    const attributes = log.attributes;
    if (!attributes) return log;
    const req = attributes.req as { url?: unknown } | undefined;
    if (typeof req?.url === 'string' && req.url.startsWith(HEALTH_PATH)) return null;
    if (isProduction) {
      for (const key of CONTENT_ATTRIBUTES) delete attributes[key];
    }
    return log;
  }
}
