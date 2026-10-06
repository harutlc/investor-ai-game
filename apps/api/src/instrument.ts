// Sentry must initialise before any other module is imported, so this file is preloaded with
// `node --import` (see the api package scripts and the Dockerfile) instead of being imported by main.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/node';
import { parse as parseDotenv } from 'dotenv';
import { WorkspaceRoot } from './config/WorkspaceRoot.js';

/** Process env over the repo-root `.env`, mirroring ConfigLoader (which runs too late for Sentry). */
function readEnv(): Record<string, string | undefined> {
  let fromFile: Record<string, string> = {};
  try {
    fromFile = parseDotenv(readFileSync(path.join(WorkspaceRoot.find(), '.env')));
  } catch {
    // No .env (containers): the real environment is all there is.
  }
  return { ...fromFile, ...process.env };
}

const env = readEnv();
const nodeEnv = env.NODE_ENV || 'development';

Sentry.init({
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
});
