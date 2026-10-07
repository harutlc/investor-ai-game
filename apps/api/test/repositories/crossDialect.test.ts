import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { MessageRepository } from '../../src/repositories/MessageRepository.js';
import { OfferRepository } from '../../src/repositories/OfferRepository.js';
import { seedPlayer, sessionFixture } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

// The database-backends guarantee: values and ordering come back the same on every dialect.

let database: Database;

describe.each(dialectsUnderTest())('cross-dialect round trips (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
  });
  afterEach(() => database.close());

  it('round-trips amounts beyond 32 bits', async () => {
    const session = await new GameSessionRepository(database).create(
      sessionFixture(await seedPlayer(database)),
    );
    const offers = new OfferRepository(database);
    const stored = await offers.add({
      id: randomUUID(),
      sessionId: session.id,
      from: 'investor',
      investment: 500_000_000,
      equity: 10,
      impliedValuation: 5_000_000_000,
      turn: 1,
      createdAt: new Date(),
    });
    expect(await offers.listForSession(session.id)).toEqual([stored]);
    expect((await offers.latest(session.id, 'investor'))?.impliedValuation).toBe(5_000_000_000);
  });

  it('keeps timestamps to the millisecond', async () => {
    const at = new Date('2026-10-07T12:00:00.123Z');
    const playerId = await seedPlayer(database);
    const sessions = new GameSessionRepository(database, () => new Date('2026-10-07T12:00:01.999Z'));
    const session = await sessions.create(sessionFixture(playerId, { createdAt: at, updatedAt: at }));
    expect((await sessions.findForPlayer(session.id, playerId))?.createdAt.toISOString()).toBe(
      '2026-10-07T12:00:00.123Z',
    );
    await sessions.update(session.id, { turn: 1 });
    expect((await sessions.findForPlayer(session.id, playerId))?.updatedAt.toISOString()).toBe(
      '2026-10-07T12:00:01.999Z',
    );
  });

  it('round-trips structured investor state and options exactly', async () => {
    const playerId = await seedPlayer(database);
    const sessions = new GameSessionRepository(database);
    const session = await sessions.create(
      sessionFixture(playerId, {
        investorState: {
          budget: 700_000,
          minEquity: 15.5,
          maxEquity: 30,
          concessionStep: 3,
          interest: 0.123456789,
          patience: 3,
        },
        playerOptions: [{ id: 'opt-1-1', kind: 'decline', label: 'Walk away — «€»' }],
      }),
    );
    expect(await sessions.findForPlayer(session.id, playerId)).toEqual(session);
  });

  it('reports a matched update as a change even when no value differs', async () => {
    const at = new Date('2026-10-07T12:00:00.000Z');
    const playerId = await seedPlayer(database);
    const sessions = new GameSessionRepository(database, () => at);
    const session = await sessions.create(sessionFixture(playerId, { createdAt: at, updatedAt: at }));
    expect(await sessions.update(session.id, { turn: session.turn }, { expectedTurn: session.turn })).toBe(
      true,
    );
  });

  it('keeps same-millisecond insertion order across many rows', async () => {
    const session = await new GameSessionRepository(database).create(
      sessionFixture(await seedPlayer(database)),
    );
    const messages = new MessageRepository(database);
    const at = new Date('2026-10-07T12:00:00.000Z');
    const texts = Array.from({ length: 25 }, (_, i) => `m${i}`);
    for (const text of texts) {
      await messages.add({ id: randomUUID(), sessionId: session.id, role: 'player', text, createdAt: at });
    }
    expect((await messages.listForSession(session.id)).map((m) => m.text)).toEqual(texts);
  });
});
