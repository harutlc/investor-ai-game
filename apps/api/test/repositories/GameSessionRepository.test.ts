import { randomUUID } from 'node:crypto';
import type { PlayerOption } from '@investor/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { T0, seedPlayer, sessionFixture } from '../support/gameFixtures.js';

const LATER = new Date('2026-10-03T11:00:00.000Z');

let database: Database;
let repository: GameSessionRepository;
let playerId: string;

beforeEach(() => {
  database = new Database(':memory:');
  repository = new GameSessionRepository(database.db, () => LATER);
  playerId = seedPlayer(database);
});
afterEach(() => database.close());

describe('GameSessionRepository', () => {
  it('creates a session and reads it back unchanged', () => {
    const session = repository.create(sessionFixture(playerId));
    const found = repository.findForPlayer(session.id, playerId);
    expect(found).toEqual(session);
    expect(found?.investorState.budget).toBe(700_000);
    expect(found?.investorState.patience).toBe(3);
  });

  it('stores a session without an investor offer or scenario', () => {
    const session = repository.create(sessionFixture(playerId, { currentInvestorOffer: null }));
    expect(repository.findForPlayer(session.id, playerId)?.currentInvestorOffer).toBeNull();
  });

  it('refuses a session for an unknown player', () => {
    expect(() => repository.create(sessionFixture(randomUUID()))).toThrow();
    expect(repository.listForPlayer(playerId)).toEqual([]);
  });

  it("does not return another player's session", () => {
    const session = repository.create(sessionFixture(playerId));
    const otherPlayer = seedPlayer(database);
    expect(repository.findForPlayer(session.id, otherPlayer)).toBeUndefined();
    expect(repository.findForPlayer(randomUUID(), otherPlayer)).toBeUndefined();
  });

  it("lists a player's sessions newest first", () => {
    const older = repository.create(sessionFixture(playerId));
    const newer = repository.create(sessionFixture(playerId, { createdAt: LATER, updatedAt: LATER }));
    repository.create(sessionFixture(seedPlayer(database)));
    expect(repository.listForPlayer(playerId).map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it('breaks createdAt ties by insertion order', () => {
    const first = repository.create(sessionFixture(playerId));
    const second = repository.create(sessionFixture(playerId));
    expect(repository.listForPlayer(playerId).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it('updates the turn, offer and state and refreshes updatedAt', () => {
    const session = repository.create(sessionFixture(playerId));
    const offer = {
      investment: 500_000,
      equity: 24,
      impliedValuation: 2_083_333,
      from: 'investor',
      turn: 2,
    } as const;
    repository.update(session.id, {
      turn: 2,
      currentInvestorOffer: offer,
      investorState: { ...session.investorState, patience: 2 },
      status: 'negotiating',
    });
    const found = repository.findForPlayer(session.id, playerId)!;
    expect(found.turn).toBe(2);
    expect(found.currentInvestorOffer).toEqual(offer);
    expect(found.investorState.patience).toBe(2);
    expect(found.createdAt).toEqual(T0);
    expect(found.updatedAt).toEqual(LATER);
  });

  it('stores the player options and replaces them on update', () => {
    const options: PlayerOption[] = [
      {
        id: 'opt-1-1',
        kind: 'counter',
        label: 'Counter: €500k for 20%',
        offer: { investment: 500_000, equity: 20, impliedValuation: 2_500_000, from: 'player', turn: 1 },
      },
      { id: 'opt-1-2', kind: 'decline', label: 'Walk away' },
    ];
    const session = repository.create(sessionFixture(playerId, { playerOptions: options }));
    expect(repository.findForPlayer(session.id, playerId)?.playerOptions).toEqual(options);

    const next: PlayerOption[] = [{ id: 'opt-2-1', kind: 'accept', label: 'Accept €500k for 26%' }];
    repository.update(session.id, { playerOptions: next });
    expect(repository.findForPlayer(session.id, playerId)?.playerOptions).toEqual(next);
    repository.update(session.id, { playerOptions: [] });
    expect(repository.findForPlayer(session.id, playerId)?.playerOptions).toEqual([]);
  });

  it('rejects a counter option without an offer', () => {
    const bad = [{ id: 'opt-1-1', kind: 'counter', label: 'Counter' }] as PlayerOption[];
    expect(() => repository.create(sessionFixture(playerId, { playerOptions: bad }))).toThrow();
    expect(repository.listForPlayer(playerId)).toEqual([]);
  });

  it('only updates a session still on the expected turn', () => {
    const session = repository.create(sessionFixture(playerId, { turn: 2 }));
    expect(repository.update(session.id, { turn: 3 }, { expectedTurn: 1 })).toBe(false);
    expect(repository.findForPlayer(session.id, playerId)?.turn).toBe(2);
    expect(repository.update(session.id, { turn: 3 }, { expectedTurn: 2 })).toBe(true);
    expect(repository.findForPlayer(session.id, playerId)?.turn).toBe(3);
  });

  it('rejects an invalid investor state on write', () => {
    const session = repository.create(sessionFixture(playerId));
    expect(() =>
      repository.update(session.id, { investorState: { ...session.investorState, patience: -1 } }),
    ).toThrow();
  });

  it('fails loudly when a stored JSON column has drifted', () => {
    const session = repository.create(sessionFixture(playerId));
    database.sqlite
      .prepare('update game_sessions set investor_state = \'{"budget":1}\' where id = ?')
      .run(session.id);
    expect(() => repository.findForPlayer(session.id, playerId)).toThrow(/investor_state/);
  });

  it('deletes a session', () => {
    const session = repository.create(sessionFixture(playerId));
    repository.delete(session.id);
    expect(repository.findForPlayer(session.id, playerId)).toBeUndefined();
  });
});
