import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config/AppConfig.js';

/** Header values that must never reach the logs. */
export const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
] as const;

export class LoggerFactory {
  /** Structured JSON logs; pretty-printed in development unless an explicit destination is given. */
  static create(config: AppConfig, destination?: DestinationStream): Logger {
    const options = {
      level: config.logging.level,
      redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
    };
    if (destination) return pino(options, destination);
    if (config.nodeEnv === 'development') {
      return pino({ ...options, transport: { target: 'pino-pretty', options: { singleLine: true } } });
    }
    return pino(options);
  }
}
