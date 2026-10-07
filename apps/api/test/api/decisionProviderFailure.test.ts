import { Writable } from 'node:stream';
import * as Sentry from '@sentry/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemOneDecisionProvider } from '../../src/llm/decision/SystemOneDecisionProvider.js';
import { LlmCallLogger } from '../../src/logging/LlmCallLogger.js';
import { LlmPricing } from '../../src/logging/LlmPricing.js';
import { LoggerFactory } from '../../src/logging/LoggerFactory.js';
import { SentryOptions } from '../../src/monitoring/SentryOptions.js';
import { createTestApp } from '../support/createTestApp.js';
import { connectionRefused, stubFetch } from '../support/stubFetch.js';
import { testConfig } from '../support/testConfig.js';

interface SentEvent {
  tags?: Record<string, string>;
}

const events: SentEvent[] = [];

/** Collects the error events the SDK would send, instead of sending them. */
function captureTransport() {
  return {
    send(envelope: [unknown, [{ type: string }, unknown][]]) {
      for (const [header, payload] of envelope[1]) {
        if (header.type === 'event') events.push(payload as SentEvent);
      }
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  };
}

beforeAll(() => {
  Sentry.init({
    ...SentryOptions.build({ SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0', NODE_ENV: 'test' }),
    transport: captureTransport,
    tracesSampleRate: 0,
  });
});

afterAll(() => Sentry.close());

const PITCH = {
  name: 'GreenCharge',
  sector: 'EV charging',
  description: 'Fast chargers for apartment buildings.',
  valuation: 2_000_000,
  askAmount: 500_000,
};

describe('a decision backend that is down during a game turn', () => {
  it('answers 503, logs one llm.call_failed with the request id, and sends one Sentry event', async () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    const config = testConfig({ logLevel: 'info' });
    const logger = LoggerFactory.create(config, sink);
    const llmCalls = new LlmCallLogger({ logger, pricing: new LlmPricing({}, logger), logContent: false });
    const { fetch } = stubFetch(connectionRefused);
    const laya = new SystemOneDecisionProvider('laya', config.llm.decision.providers.laya, undefined, {
      logger,
      fetch,
      llmCalls,
    });
    const { app } = await createTestApp({ logger, decisionProvider: laya, csrf: false });
    const agent = request.agent(app);
    const game = (await agent.post('/api/games').send({ personaId: 'greedy-shark', pitch: PITCH })).body as {
      id: string;
    };
    await Sentry.flush(2000);
    events.length = 0;
    lines.length = 0;

    const id = '5c1d7a0e-2b3f-4c4d-8e9f-0a1b2c3d4e5f';
    const res = await agent
      .post(`/api/games/${game.id}/turns`)
      .set('X-Request-Id', id)
      .send({ offer: { investment: 500_000, equity: 15 } });
    await Sentry.flush(2000);

    expect(res.status).toBe(503);
    expect((res.body as { error: { code: string } }).error.code).toBe('PROVIDER_UNAVAILABLE');
    // One decision call this turn: one failure line, and the HTTP error handler does not report it again.
    expect(lines.filter((line) => line.event === 'llm.call_failed')).toEqual([
      expect.objectContaining({
        level: 50,
        provider: 'laya',
        operation: 'decide',
        status: null,
        requestId: id,
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.tags?.request_id).toBe(id);
    expect(lines.filter((line) => line.level === 50 && line.event !== 'llm.call_failed')).toEqual([]);
  });
});
