import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import {
  DecisionLogRepository,
  type DecisionLogEntry,
} from '../../src/repositories/DecisionLogRepository.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { MessageRepository } from '../../src/repositories/MessageRepository.js';
import { OfferRepository } from '../../src/repositories/OfferRepository.js';
import { T0, seedSession } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

let database: Database;
let repository: DecisionLogRepository;

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

describe.each(dialectsUnderTest())('DecisionLogRepository (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    repository = new DecisionLogRepository(database);
  });
  afterEach(() => database.close());

  it('lists entries by turn with questions, answers and latency intact', async () => {
    const session = await seedSession(database);
    const turn2 = await repository.add(entry(session.id, 2));
    const turn1 = await repository.add(entry(session.id, 1, { stage: 'A' }));
    expect(await repository.listForSession(session.id)).toEqual([turn1, turn2]);
  });

  it('keeps creation order within a turn', async () => {
    const session = await seedSession(database);
    const first = await repository.add(entry(session.id, 1, { provider: 'first' }));
    const second = await repository.add(entry(session.id, 1, { provider: 'second' }));
    expect((await repository.listForSession(session.id)).map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it('round-trips a failed call', async () => {
    const session = await seedSession(database);
    const failed = await repository.add(
      entry(session.id, 3, { model: null, answers: null, errorCode: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(await repository.listForSession(session.id)).toEqual([failed]);
  });

  it('refuses an entry for an unknown session', async () => {
    await expect(repository.add(entry(randomUUID(), 1))).rejects.toThrow();
  });

  it('deleting a session removes its messages, offers and decision logs', async () => {
    const session = await seedSession(database);
    const keep = await seedSession(database);
    const messages = new MessageRepository(database);
    const offers = new OfferRepository(database);
    for (const id of [session.id, keep.id]) {
      await messages.add({ id: randomUUID(), sessionId: id, role: 'player', text: 'hi', createdAt: T0 });
      await offers.add({
        id: randomUUID(),
        sessionId: id,
        from: 'player',
        investment: 500_000,
        equity: 15,
        impliedValuation: 3_333_333,
        turn: 1,
        createdAt: T0,
      });
      await repository.add(entry(id, 1));
    }

    await new GameSessionRepository(database).delete(session.id);

    expect(await messages.listForSession(session.id)).toEqual([]);
    expect(await offers.listForSession(session.id)).toEqual([]);
    expect(await repository.listForSession(session.id)).toEqual([]);
    expect(await messages.listForSession(keep.id)).toHaveLength(1);
    expect(await offers.listForSession(keep.id)).toHaveLength(1);
    expect(await repository.listForSession(keep.id)).toHaveLength(1);
  });
});
