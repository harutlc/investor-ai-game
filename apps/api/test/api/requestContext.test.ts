import { setTimeout as sleep } from 'node:timers/promises';
import { Writable } from 'node:stream';
import type { Logger } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import type {
  JsonRequest,
  JsonResult,
  TextResult,
  ThinkingProvider,
} from '../../src/llm/thinking/ThinkingProvider.js';
import { LoggerFactory } from '../../src/logging/LoggerFactory.js';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { choice, noul, score } from '../support/brainFixtures.js';
import { createTestApp } from '../support/createTestApp.js';
import { testConfig } from '../support/testConfig.js';

/** A provider that, like the real ones, only holds the root logger. It logs after an await, then fails. */
class LoggingProvider implements ThinkingProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake';
  logger: Logger | undefined;

  private async call(): Promise<never> {
    await sleep(1);
    this.logger?.info({ event: 'provider.call' }, 'provider called');
    throw new ProviderUnavailableError();
  }

  generateText(): Promise<TextResult> {
    return this.call();
  }

  generateJson<T>(_request: JsonRequest<T>): Promise<JsonResult<T>> {
    return this.call();
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }
}

async function setup() {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const logger = LoggerFactory.create(testConfig({ logLevel: 'info' }), sink);
  const provider = new LoggingProvider();
  provider.logger = logger;
  const decisions = new FakeDecisionProvider();
  const { app } = await createTestApp({ logger, thinkingProvider: provider, decisionProvider: decisions });
  return { app, lines, decisions };
}

const PITCH = {
  name: 'GreenCharge',
  sector: 'EV charging',
  description: 'Fast chargers for apartment buildings.',
  valuation: 2_000_000,
  askAmount: 500_000,
};

describe('request id on every log line', () => {
  it('tags provider lines written during a game turn with that request id', async () => {
    const { app, lines, decisions } = await setup();
    const agent = request.agent(app);
    const { csrfToken } = (await agent.get('/api/csrf-token')).body as { csrfToken: string };
    const game = (
      await agent
        .post('/api/games')
        .set('X-CSRF-Token', csrfToken)
        .send({ personaId: 'greedy-shark', pitch: PITCH })
    ).body as { id: string };
    decisions.enqueue({
      accept: score(1),
      reaction: choice('counter'),
      good_deal: noul(0.3),
      concession_size: choice('medium'),
      politeness: score(3),
      insult: noul(0.02),
    });
    lines.length = 0;

    const id = '0b6f6a52-3f0e-4b8c-9d61-7a1f2e3d4c5b';
    const res = await agent
      .post(`/api/games/${game.id}/turns`)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Request-Id', id)
      .send({ offer: { investment: 500_000, equity: 15 } });

    expect(res.status).toBe(200);
    const providerLines = lines.filter((line) => line.event === 'provider.call');
    expect(providerLines.length).toBeGreaterThan(0);
    for (const line of providerLines) expect(line.requestId).toBe(id);
    const completed = lines.find((line) => line.msg === 'request completed');
    expect(completed?.requestId).toBe(id);
  });

  it('keeps concurrent requests apart', async () => {
    const { app, lines } = await setup();
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    await Promise.all(ids.map((id) => request(app).get('/api/personas').set('X-Request-Id', id)));
    const completed = lines.filter((line) => line.msg === 'request completed');
    expect(completed.map((line) => line.requestId).sort()).toEqual(ids);
    for (const line of completed) expect((line.req as { id: string }).id).toBe(line.requestId);
  });
});
