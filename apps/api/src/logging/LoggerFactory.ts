import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/AppConfig.js';
import { RequestContext } from './RequestContext.js';

/** Header values that must never reach the logs. */
const REDACTED_HEADER_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
] as const;

/** Field names redacted wherever they appear at the top level of a log line or one level inside it. */
export const REDACTED_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
] as const;

export const REDACTED_PATHS: readonly string[] = [
  ...REDACTED_HEADER_PATHS,
  ...REDACTED_FIELDS.flatMap((field) => [field, `*.${field}`]),
];

const BASE_OPTIONS: LoggerOptions = {
  redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
  // A fresh object each time: pino merges the line's own fields into the mixin's result.
  mixin: () => {
    const context = RequestContext.get();
    return context ? { requestId: context.requestId } : {};
  },
};

export class LoggerFactory {
  /** Structured JSON logs; pretty-printed in development unless an explicit destination is given. */
  static create(config: AppConfig, destination?: DestinationStream): Logger {
    const options = { ...BASE_OPTIONS, level: config.logging.level };
    if (destination) return pino(options, destination);
    if (config.nodeEnv === 'development') {
      return pino({ ...options, transport: { target: 'pino-pretty', options: { singleLine: true } } });
    }
    return pino(options);
  }

  /** For the moments before the configuration is loaded (or when it fails to load). */
  static bootstrap(destination?: DestinationStream): Logger {
    const options = { ...BASE_OPTIONS, level: 'info' };
    return destination ? pino(options, destination) : pino(options);
  }
}
