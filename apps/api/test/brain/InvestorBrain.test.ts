import type { DecisionAnswer } from '@investor/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvestorBrain } from '../../src/brain/InvestorBrain.js';
import { mvpQuestionSets } from '../../src/brain/mvpQuestionSets.js';
import { QuestionSetRegistry } from '../../src/brain/QuestionSetRegistry.js';
import type { Database } from '../../src/db/Database.js';
import { ConfidenceGate } from '../../src/llm/decision/ConfidenceGate.js';
import { DecisionLogger } from '../../src/llm/decision/DecisionLogger.js';
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResult,
  QuestionSet,
} from '../../src/llm/decision/DecisionProvider.js';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { ProviderBadResponseError } from '../../src/llm/errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { DecisionLogRepository } from '../../src/repositories/DecisionLogRepository.js';
import { brainMove, choice, noul, score } from '../support/brainFixtures.js';
import { T0, seedSession } from '../support/gameFixtures.js';
import { captureLogger } from '../support/silentLogger.js';
import { testConfig } from '../support/testConfig.js';
import { openTestDatabase } from '../support/testDatabase.js';

/**
 * Wraps the fake provider so a test can hold each call until a hook resolves: to prove that the calls of
 * a stage are in flight together, or to delay one of them.
 */
class ControlledProvider implements DecisionProvider {
  readonly name = 'fake' as const;
  private calls = 0;

  constructor(
    readonly fake: FakeDecisionProvider,
    private readonly beforeAnswer: (call: number) => Promise<void>,
  ) {}

  async decide<const Q extends QuestionSet>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    await this.beforeAnswer(this.calls++);
    return this.fake.decide(request);
  }

  decideMany(requests: readonly DecisionRequest[]): Promise<DecisionResult[]> {
    return Promise.all(requests.map((request) => this.decide(request)));
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }
}

/** Answers for every MVP question; each request reads only its own. */
const ANSWERS: Record<string, DecisionAnswer> = {
  intent: choice('counter_offer'),
  injection: noul(0.02),
  investment: choice('€500,000'),
  equity: choice('15%'),
  accept: score(1),
  reaction: choice('counter'),
  good_deal: noul(0.31),
  concession_size: choice('small'),
  politeness: score(3),
  insult: noul(0.05),
  confidence: score(3),
};

let database: Database;
let logs: DecisionLogRepository;
let sessionId: string;

beforeEach(async () => {
  database = await openTestDatabase();
  logs = new DecisionLogRepository(database);
  sessionId = (await seedSession(database)).id;
});
afterEach(() => database.close());

function createBrain(provider: DecisionProvider = new FakeDecisionProvider()) {
  const decisions = new DecisionLogger(provider, logs, captureLogger().logger, () => T0);
  const registry = new QuestionSetRegistry(mvpQuestionSets(), testConfig().game.features);
  return new InvestorBrain(registry, decisions, new ConfidenceGate(0.55));
}

function fakeWith(...answers: (Record<string, DecisionAnswer> | Error)[]) {
  return new FakeDecisionProvider(answers);
}

describe('InvestorBrain.understand (Stage A)', () => {
  it('reads "€500k for 15%" as a counter-offer with both numbers', async () => {
    const brain = createBrain(fakeWith(ANSWERS, ANSWERS));
    const message = '€500k for 15%';

    const result = await brain.understand({ sessionId, turn: 1, ...brainMove(message), message });

    expect(result).toEqual({
      intent: { value: 'counter_offer', confidence: 0.9, uncertain: false },
      injection: { value: 0.02, confidence: 0.98, uncertain: false },
      offer: {
        investment: { value: 500_000, confidence: 0.9, uncertain: false },
        equity: { value: 15, confidence: 0.9, uncertain: false },
      },
    });
    const entries = await logs.listForSession(sessionId);
    expect(entries.map((entry) => [entry.stage, entry.turn])).toEqual([
      ['A', 1],
      ['A', 1],
    ]);
  });

  it('asks only the intent set when the message has no numbers', async () => {
    const brain = createBrain(fakeWith(ANSWERS));
    const message = 'Tell me about your fund';

    const result = await brain.understand({ sessionId, turn: 1, ...brainMove(message), message });

    expect(result.offer).toEqual({ investment: null, equity: null });
    expect(await logs.listForSession(sessionId)).toHaveLength(1);
  });
});

describe('InvestorBrain.evaluate (Stage B)', () => {
  it('asks deal and conduct for a move with text, logging two B entries', async () => {
    const brain = createBrain(fakeWith(ANSWERS, ANSWERS));

    const judgment = await brain.evaluate({
      sessionId,
      turn: 4,
      ...brainMove('€500k for 15%', { investment: 500_000, equity: 15 }),
    });

    expect(judgment.deal.reaction).toEqual({ value: 'counter', confidence: 0.9, uncertain: false });
    expect(judgment.conduct?.politeness).toEqual({ value: 3, confidence: 0.9, uncertain: false });
    const entries = await logs.listForSession(sessionId);
    expect(entries.map((entry) => [entry.stage, entry.turn])).toEqual([
      ['B', 4],
      ['B', 4],
    ]);
    expect(entries.map((entry) => Object.keys(entry.questions)).sort()).toEqual([
      ['accept', 'reaction', 'good_deal', 'concession_size'],
      ['politeness', 'insult', 'confidence'],
    ]);
  });

  it('asks only deal for a structured offer without text', async () => {
    const brain = createBrain(fakeWith(ANSWERS));

    const judgment = await brain.evaluate({
      sessionId,
      turn: 2,
      ...brainMove(null, { investment: 500_000, equity: 15 }),
    });

    expect('conduct' in judgment).toBe(false);
    expect(await logs.listForSession(sessionId)).toHaveLength(1);
  });

  it('marks a low-confidence reaction as uncertain without changing it', async () => {
    const brain = createBrain(fakeWith({ ...ANSWERS, reaction: choice('counter', 0.4) }));

    const judgment = await brain.evaluate({
      sessionId,
      turn: 2,
      ...brainMove(null, { investment: 500_000, equity: 15 }),
    });

    expect(judgment.deal.reaction).toEqual({ value: 'counter', confidence: 0.4, uncertain: true });
  });

  it('sends the requests of a stage concurrently', async () => {
    let arrived = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => (release = resolve));
    const provider = new ControlledProvider(fakeWith(ANSWERS, ANSWERS), async () => {
      if (++arrived === 2) release();
      // Sequential calls would never get a second arrival; fail fast instead of hanging.
      await Promise.race([
        bothArrived,
        new Promise((_, reject) => setTimeout(() => reject(new Error('requests were not concurrent')), 200)),
      ]);
    });

    const judgment = await createBrain(provider).evaluate({ sessionId, turn: 3, ...brainMove('Deal?') });

    expect(judgment.conduct).toBeDefined();
  });

  it('fails with the provider error only after every call is logged', async () => {
    // The deal call fails at once; the conduct call answers later.
    const provider = new ControlledProvider(fakeWith(new ProviderUnavailableError(), ANSWERS), (call) =>
      call === 1 ? new Promise((resolve) => setTimeout(resolve, 30)) : Promise.resolve(),
    );

    await expect(
      createBrain(provider).evaluate({ sessionId, turn: 5, ...brainMove('Deal?') }),
    ).rejects.toThrow(ProviderUnavailableError);

    const entries = await logs.listForSession(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.errorCode).sort()).toEqual(['PROVIDER_UNAVAILABLE', null]);
  });

  it('reports the first failure in registry order', async () => {
    const brain = createBrain(fakeWith(new ProviderBadResponseError(), new ProviderUnavailableError()));

    await expect(brain.evaluate({ sessionId, turn: 5, ...brainMove('Deal?') })).rejects.toThrow(
      ProviderBadResponseError,
    );
  });

  it('never writes the state (and its hidden budget) to the decision log', async () => {
    const brain = createBrain(fakeWith(ANSWERS, ANSWERS));
    const move = brainMove('€500k for 15%', { investment: 500_000, equity: 15 });
    expect(move.state.investor.budget).toBe(700_000);

    await brain.evaluate({ sessionId, turn: 2, ...move });

    const logged = JSON.stringify(await logs.listForSession(sessionId));
    expect(logged).not.toContain('700000');
    expect(logged).not.toContain('budget');
  });
});
