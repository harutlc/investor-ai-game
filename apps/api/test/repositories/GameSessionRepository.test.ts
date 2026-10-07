import { randomUUID } from 'node:crypto';
import type { PlayerOption } from '@investor/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { T0, seedPlayer, sessionFixture } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

const LATER = new Date('2026-10-03T11:00:00.000Z');

let database: Database;
let repository: GameSessionRepository;
let playerId: string;

describe.each(dialectsUnderTest())('GameSessionRepository (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    repository = new GameSessionRepository(database, () => LATER);
    playerId = await seedPlayer(database);
  });
  afterEach(() => database.close());

  it('creates a session and reads it back unchanged', async () => {
    const session = await repository.create(sessionFixture(playerId));
    const found = await repository.findForPlayer(session.id, playerId);
    expect(found).toEqual(session);
    expect(found?.investorState.budget).toBe(700_000);
    expect(found?.investorState.patience).toBe(3);
  });

  it('stores a session without an investor offer or scenario', async () => {
    const session = await repository.create(sessionFixture(playerId, { currentInvestorOffer: null }));
    expect((await repository.findForPlayer(session.id, playerId))?.currentInvestorOffer).toBeNull();
  });

  it('refuses a session for an unknown player', async () => {
    await expect(repository.create(sessionFixture(randomUUID()))).rejects.toThrow();
    expect(await repository.listForPlayer(playerId)).toEqual([]);
  });

  it("does not return another player's session", async () => {
    const session = await repository.create(sessionFixture(playerId));
    const otherPlayer = await seedPlayer(database);
    expect(await repository.findForPlayer(session.id, otherPlayer)).toBeUndefined();
    expect(await repository.findForPlayer(randomUUID(), otherPlayer)).toBeUndefined();
  });

  it("lists a player's sessions newest first", async () => {
    const older = await repository.create(sessionFixture(playerId));
    const newer = await repository.create(sessionFixture(playerId, { createdAt: LATER, updatedAt: LATER }));
    await repository.create(sessionFixture(await seedPlayer(database)));
    expect((await repository.listForPlayer(playerId)).map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it('breaks createdAt ties by insertion order', async () => {
    const first = await repository.create(sessionFixture(playerId));
    const second = await repository.create(sessionFixture(playerId));
    expect((await repository.listForPlayer(playerId)).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it('updates the turn, offer and state and refreshes updatedAt', async () => {
    const session = await repository.create(sessionFixture(playerId));
    const offer = {
      investment: 500_000,
      equity: 24,
      impliedValuation: 2_083_333,
      from: 'investor',
      turn: 2,
    } as const;
    await repository.update(session.id, {
      turn: 2,
      currentInvestorOffer: offer,
      investorState: { ...session.investorState, patience: 2 },
      status: 'negotiating',
    });
    const found = (await repository.findForPlayer(session.id, playerId))!;
    expect(found.turn).toBe(2);
    expect(found.currentInvestorOffer).toEqual(offer);
    expect(found.investorState.patience).toBe(2);
    expect(found.createdAt).toEqual(T0);
    expect(found.updatedAt).toEqual(LATER);
  });

  it('stores the player options and replaces them on update', async () => {
    const options: PlayerOption[] = [
      {
        id: 'opt-1-1',
        kind: 'counter',
        label: 'Counter: €500k for 20%',
        offer: { investment: 500_000, equity: 20, impliedValuation: 2_500_000, from: 'player', turn: 1 },
      },
      { id: 'opt-1-2', kind: 'decline', label: 'Walk away' },
    ];
    const session = await repository.create(sessionFixture(playerId, { playerOptions: options }));
    expect((await repository.findForPlayer(session.id, playerId))?.playerOptions).toEqual(options);

    const next: PlayerOption[] = [{ id: 'opt-2-1', kind: 'accept', label: 'Accept €500k for 26%' }];
    await repository.update(session.id, { playerOptions: next });
    expect((await repository.findForPlayer(session.id, playerId))?.playerOptions).toEqual(next);
    await repository.update(session.id, { playerOptions: [] });
    expect((await repository.findForPlayer(session.id, playerId))?.playerOptions).toEqual([]);
  });

  it('rejects a counter option without an offer', async () => {
    const bad = [{ id: 'opt-1-1', kind: 'counter', label: 'Counter' }] as PlayerOption[];
    await expect(repository.create(sessionFixture(playerId, { playerOptions: bad }))).rejects.toThrow();
    expect(await repository.listForPlayer(playerId)).toEqual([]);
  });

  it('only updates a session still on the expected turn', async () => {
    const session = await repository.create(sessionFixture(playerId, { turn: 2 }));
    expect(await repository.update(session.id, { turn: 3 }, { expectedTurn: 1 })).toBe(false);
    expect((await repository.findForPlayer(session.id, playerId))?.turn).toBe(2);
    expect(await repository.update(session.id, { turn: 3 }, { expectedTurn: 2 })).toBe(true);
    expect((await repository.findForPlayer(session.id, playerId))?.turn).toBe(3);
  });

  it('rejects an invalid investor state on write', async () => {
    const session = await repository.create(sessionFixture(playerId));
    await expect(
      repository.update(session.id, { investorState: { ...session.investorState, patience: -1 } }),
    ).rejects.toThrow();
  });

  it('fails loudly when a stored JSON column has drifted', async () => {
    const session = await repository.create(sessionFixture(playerId));
    const { gameSessions } = database.tables;
    await database.query((db) =>
      db
        .update(gameSessions)
        .set({ investorState: { budget: 1 } })
        .where(eq(gameSessions.id, session.id)),
    );
    await expect(repository.findForPlayer(session.id, playerId)).rejects.toThrow(/investor_state/);
  });

  it('deletes a session', async () => {
    const session = await repository.create(sessionFixture(playerId));
    await repository.delete(session.id);
    expect(await repository.findForPlayer(session.id, playerId)).toBeUndefined();
  });
});
