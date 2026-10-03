import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import {
  DecisionLogRepository,
  type DecisionLogEntry,
} from '../../src/repositories/DecisionLogRepository.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { MessageRepository } from '../../src/repositories/MessageRepository.js';
import { OfferRepository } from '../../src/repositories/OfferRepository.js';
import { T0, seedSession } from '../support/gameFixtures.js';

let database: Database;
let repository: DecisionLogRepository;

beforeEach(() => {
  database = new Database(':memory:');
  repository = new DecisionLogRepository(database.db);
});
afterEach(() => database.close());

const entry = (
  sessionId: string,
  turn: number,
  overrides: Partial<DecisionLogEntry> = {},
): DecisionLogEntry => ({
  id: randomUUID(),
  sessionId,
  turn,
  stage: 'B',
  provider: 'laya',
  model: 'english',
  questions: {
    good_deal: { type: 'noul', instructions: "The player's offer is attractive enough." },
    reaction: { type: 'choice', instructions: 'How to react', criteria: { accept: null, counter: null } },
  },
  answers: {
    good_deal: { type: 'noul', probability: 0.31 },
    reaction: {
      type: 'choice',
      value: 'counter',
      confidence: 0.8,
      probabilities: { accept: 0.2, counter: 0.8 },
    },
  },
  errorCode: null,
  latencyMs: 142,
  createdAt: T0,
  ...overrides,
});

describe('DecisionLogRepository', () => {
  it('lists entries by turn with questions, answers and latency intact', () => {
    const session = seedSession(database);
    const turn2 = repository.add(entry(session.id, 2));
    const turn1 = repository.add(entry(session.id, 1, { stage: 'A' }));
    expect(repository.listForSession(session.id)).toEqual([turn1, turn2]);
  });

  it('keeps creation order within a turn', () => {
    const session = seedSession(database);
    const first = repository.add(entry(session.id, 1, { provider: 'first' }));
    const second = repository.add(entry(session.id, 1, { provider: 'second' }));
    expect(repository.listForSession(session.id).map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it('round-trips a failed call', () => {
    const session = seedSession(database);
    const failed = repository.add(
      entry(session.id, 3, { model: null, answers: null, errorCode: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(repository.listForSession(session.id)).toEqual([failed]);
  });

  it('refuses an entry for an unknown session', () => {
    expect(() => repository.add(entry(randomUUID(), 1))).toThrow();
  });

  it('deleting a session removes its messages, offers and decision logs', () => {
    const session = seedSession(database);
    const keep = seedSession(database);
    const messages = new MessageRepository(database.db);
    const offers = new OfferRepository(database.db);
    for (const id of [session.id, keep.id]) {
      messages.add({ id: randomUUID(), sessionId: id, role: 'player', text: 'hi', createdAt: T0 });
      offers.add({
        id: randomUUID(),
        sessionId: id,
        from: 'player',
        investment: 500_000,
        equity: 15,
        impliedValuation: 3_333_333,
        turn: 1,
        createdAt: T0,
      });
      repository.add(entry(id, 1));
    }

    new GameSessionRepository(database.db).delete(session.id);

    expect(messages.listForSession(session.id)).toEqual([]);
    expect(offers.listForSession(session.id)).toEqual([]);
    expect(repository.listForSession(session.id)).toEqual([]);
    expect(messages.listForSession(keep.id)).toHaveLength(1);
    expect(offers.listForSession(keep.id)).toHaveLength(1);
    expect(repository.listForSession(keep.id)).toHaveLength(1);
  });
});
