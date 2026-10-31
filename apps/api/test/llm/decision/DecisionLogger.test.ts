import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/db/Database.js';
import { DecisionLogger } from '../../../src/llm/decision/DecisionLogger.js';
import { FakeDecisionProvider } from '../../../src/llm/decision/FakeDecisionProvider.js';
import { ProviderUnavailableError } from '../../../src/llm/errors/ProviderUnavailableError.js';
import { DecisionLogRepository } from '../../../src/repositories/DecisionLogRepository.js';
import { T0, seedSession } from '../../support/gameFixtures.js';
import { captureLogger } from '../../support/silentLogger.js';
import { dialectsUnderTest, openTestDatabase } from '../../support/testDatabase.js';

const questions = {
  good_deal: { type: 'noul', instructions: "The player's offer is attractive enough." },
  reaction: {
    type: 'choice',
    instructions: 'How should the investor react?',
    criteria: { accept: null, counter: null },
  },
} as const;
const state = { player_offer: { investment: 500_000, equity: 15 } };

let database: Database;
let logs: DecisionLogRepository;
let provider: FakeDecisionProvider;
let sessionId: string;

function create(repository: DecisionLogRepository = logs) {
  const { logger, lines } = captureLogger();
  return { decisions: new DecisionLogger(provider, repository, logger, () => T0), lines };
}

describe.each(dialectsUnderTest())('DecisionLogger (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    logs = new DecisionLogRepository(database);
    provider = new FakeDecisionProvider();
    sessionId = (await seedSession(database)).id;
  });
  afterEach(() => database.close());

  it('returns the answers and logs one entry', async () => {
    provider.enqueue({ good_deal: { type: 'noul', probability: 0.31 } });
    const { decisions } = create();

    const result = await decisions.decide({ sessionId, turn: 3, stage: 'B' }, { state, questions });

    expect(result.answers.good_deal).toEqual({ type: 'noul', probability: 0.31 });
    expect(result.answers.reaction.value).toBe('accept');
    expect(await logs.listForSession(sessionId)).toEqual([
      {
        id: expect.any(String),
        sessionId,
        turn: 3,
        stage: 'B',
        provider: 'fake',
        model: 'fake',
        questions,
        answers: result.answers,
        errorCode: null,
        latencyMs: 0,
        createdAt: T0,
      },
    ]);
  });

  it('logs a failed call with its error code and rethrows the same error', async () => {
    const failure = new ProviderUnavailableError();
    provider.enqueue(failure);
    const { decisions } = create();

    await expect(decisions.decide({ sessionId, turn: 1, stage: 'A' }, { state, questions })).rejects.toBe(
      failure,
    );

    const [entry] = await logs.listForSession(sessionId);
    expect(entry).toMatchObject({
      turn: 1,
      stage: 'A',
      provider: 'fake',
      model: null,
      answers: null,
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    expect(entry!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records unexpected errors as INTERNAL_ERROR', async () => {
    provider.enqueue(new Error('boom'));
    const { decisions } = create();
    await expect(decisions.decide({ sessionId, turn: 1, stage: 'B' }, { state, questions })).rejects.toThrow(
      'boom',
    );
    expect((await logs.listForSession(sessionId))[0]?.errorCode).toBe('INTERNAL_ERROR');
  });

  it('returns the answers even when the log write fails, and logs the failure', async () => {
    const broken = new DecisionLogRepository(database);
    broken.add = () => Promise.reject(new Error('disk full'));
    const { decisions, lines } = create(broken);

    const result = await decisions.decide({ sessionId, turn: 2, stage: 'B' }, { state, questions });

    expect(result.answers.reaction.value).toBe('accept');
    const errorLine = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((l) => l.level === 50);
    expect(errorLine).toMatchObject({
      sessionId,
      turn: 2,
      stage: 'B',
      msg: 'Failed to write a decision log entry',
    });
  });

  it('never stores error messages, so secrets in them cannot leak', async () => {
    provider.enqueue(new ProviderUnavailableError('rejected key sk-secret-should-not-be-stored'));
    const { decisions } = create();
    await expect(
      decisions.decide({ sessionId, turn: 1, stage: 'B' }, { state, questions }),
    ).rejects.toThrow();
    const rows = await database.query((db) => db.select().from(database.tables.decisionLogs));
    expect(JSON.stringify(rows)).not.toContain('sk-secret');
  });
});
