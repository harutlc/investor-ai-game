import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { LoggerFactory } from '../../src/logging/LoggerFactory.js';
import { ReportedErrors } from '../../src/monitoring/ReportedErrors.js';
import { SentryOptions } from '../../src/monitoring/SentryOptions.js';
import { createTestApp } from '../support/createTestApp.js';
import { testConfig } from '../support/testConfig.js';

interface SentEvent {
  tags?: Record<string, string>;
  exception?: { values?: { value?: string; mechanism?: { handled?: boolean } }[] };
}
interface SentLog {
  level: string;
  body: string;
  attributes?: Record<string, { value: unknown }>;
}

const events: SentEvent[] = [];
const logs: SentLog[] = [];

/** Collects what the SDK would send, instead of sending it. */
function captureTransport() {
  return {
    send(envelope: [unknown, [{ type: string }, unknown][]]) {
      for (const [header, payload] of envelope[1]) {
        if (header.type === 'event') events.push(payload as SentEvent);
        if (header.type === 'log') logs.push(...(payload as { items: SentLog[] }).items);
      }
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  };
}

const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
const logger = LoggerFactory.create(testConfig({ logLevel: 'info' }), sink);

const boom = {
  basePath: '/boom',
  routes: () =>
    Router()
      .get('/crash/:n', (req) => {
        throw new Error(`kaboom ${req.params.n}`);
      })
      .get('/provider-down', () => {
        throw new ProviderUnavailableError();
      })
      .get('/provider-down-reported', () => {
        const cause = new Error('429 from upstream');
        ReportedErrors.mark(cause);
        throw new ProviderUnavailableError(undefined, { cause });
      }),
};
const { app } = await createTestApp({ logger, extraControllers: [boom], csrf: false });

beforeAll(() => {
  Sentry.init({
    ...SentryOptions.build({ SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0', NODE_ENV: 'test' }),
    transport: captureTransport,
    tracesSampleRate: 0,
  });
});

afterAll(() => Sentry.close());

beforeEach(() => {
  events.length = 0;
  logs.length = 0;
});

async function settle() {
  await Sentry.flush(2000);
}

describe('Sentry wiring', () => {
  it('registers the pino integration', () => {
    expect(Sentry.getClient()?.getIntegrationByName('Pino')).toBeDefined();
  });

  it('runs an SDK at version 10.18.0 or later', () => {
    const require = createRequire(import.meta.url);
    const { version } = require('@sentry/node/package.json') as { version: string };
    const [major = 0, minor = 0] = version.split('.').map(Number);
    expect(major > 10 || (major === 10 && minor >= 18)).toBe(true);
    expect(typeof Sentry.pinoIntegration).toBe('function');
  });

  it('forwards info lines as Sentry Logs, redacted and with the request id', async () => {
    const id = '0b6f6a52-3f0e-4b8c-9d61-7a1f2e3d4c5b';
    await request(app)
      .get('/api/personas')
      .set('X-Request-Id', id)
      .set('Authorization', 'Bearer secret-token');
    await settle();
    const completed = logs.find((log) => log.body === 'request completed');
    expect(completed?.level).toBe('info');
    expect(completed?.attributes?.requestId?.value).toBe(id);
    expect(JSON.stringify(logs)).not.toContain('secret-token');
  });

  it('does not forward debug lines or health-probe request lines', async () => {
    logger.level = 'debug';
    logger.debug('only local');
    logger.level = 'info';
    await request(app).get('/api/health');
    await settle();
    expect(logs.find((log) => log.body === 'only local')).toBeUndefined();
    expect(logs.find((log) => JSON.stringify(log.attributes ?? {}).includes('/api/health'))).toBeUndefined();
  });

  it('turns an unexpected route error into exactly one handled event tagged with its request id', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    // Distinct errors: Sentry's Dedupe integration drops consecutive identical events.
    for (const [n, id] of ids.entries()) {
      const res = await request(app).get(`/api/boom/crash/${n}`).set('X-Request-Id', id);
      expect(res.status).toBe(500);
    }
    await settle();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.tags?.request_id)).toEqual(ids);
    expect(events[0]!.exception?.values?.[0]?.value).toBe('kaboom 0');
    expect(events[0]!.exception?.values?.[0]?.mechanism?.handled).toBe(true);
  });

  it('creates no event for a client error', async () => {
    const res = await request(app).get('/api/games/not-a-uuid');
    expect(res.status).toBe(400);
    await settle();
    expect(events).toHaveLength(0);
  });

  it('reports a server-side AppError once, and not again when its cause was already reported', async () => {
    expect((await request(app).get('/api/boom/provider-down')).status).toBe(503);
    expect((await request(app).get('/api/boom/provider-down-reported')).status).toBe(503);
    await settle();
    expect(events).toHaveLength(1);
  });

  it('turns a fatal line into an event but not a Sentry Log', async () => {
    logger.fatal({ err: new Error('going down') }, 'uncaught exception');
    await settle();
    expect(events).toHaveLength(1);
    expect(logs.find((log) => log.body === 'uncaught exception')).toBeUndefined();
  });
});

describe('SentryOptions.beforeSendLog', () => {
  const log = () => ({
    level: 'info' as const,
    message: 'llm.call',
    attributes: { prompt: { system: 'x' }, response: { text: 'y' }, model: 'm' },
  });

  it('drops LLM content in production', () => {
    expect(SentryOptions.beforeSendLog(log(), true)?.attributes).toEqual({ model: 'm' });
  });

  it('keeps LLM content outside production', () => {
    expect(SentryOptions.beforeSendLog(log(), false)?.attributes).toHaveProperty('prompt');
  });
});
