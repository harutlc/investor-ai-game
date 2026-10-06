// Sentry must initialise before any other module is imported, so this file is preloaded with
// `node --import` (see the api package scripts and the Dockerfile) instead of being imported by main.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/node';
import { parse as parseDotenv } from 'dotenv';
import { WorkspaceRoot } from './config/WorkspaceRoot.js';
import { SentryOptions } from './monitoring/SentryOptions.js';

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

Sentry.init(SentryOptions.build(readEnv()));
