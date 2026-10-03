import { randomUUID } from 'node:crypto';
import type { OfferSide } from '@investor/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { OfferRepository } from '../../src/repositories/OfferRepository.js';
import { T0, seedSession } from '../support/gameFixtures.js';

let database: Database;
let repository: OfferRepository;

beforeEach(() => {
  database = new Database(':memory:');
  repository = new OfferRepository(database.db);
});
afterEach(() => database.close());

const offer = (
  sessionId: string,
  from: OfferSide,
  equity: number,
  impliedValuation: number,
  turn: number,
) => ({
  id: randomUUID(),
  sessionId,
  from,
  investment: 500_000,
  equity,
  impliedValuation,
  turn,
  createdAt: T0,
});

describe('OfferRepository', () => {
  it('returns the latest offer from each side', () => {
    const session = seedSession(database);
    repository.add(offer(session.id, 'investor', 30, 1_666_667, 0));
    repository.add(offer(session.id, 'player', 15, 3_333_333, 1));
    const latestInvestor = repository.add(offer(session.id, 'investor', 24, 2_083_333, 2));

    expect(repository.latest(session.id, 'investor')).toEqual(latestInvestor);
    expect(repository.latest(session.id, 'player')?.equity).toBe(15);
  });

  it('returns undefined when a side has not offered yet', () => {
    const session = seedSession(database);
    expect(repository.latest(session.id, 'player')).toBeUndefined();
  });

  it('lists offers in turn order', () => {
    const session = seedSession(database);
    repository.add(offer(session.id, 'investor', 24, 2_083_333, 2));
    repository.add(offer(session.id, 'investor', 30, 1_666_667, 0));
    repository.add(offer(session.id, 'player', 15, 3_333_333, 1));
    expect(repository.listForSession(session.id).map((o) => o.turn)).toEqual([0, 1, 2]);
  });

  it('rejects an inconsistent implied valuation', () => {
    const session = seedSession(database);
    expect(() => repository.add(offer(session.id, 'player', 15, 2_000_000, 1))).toThrow();
  });

  it('refuses an offer for an unknown session', () => {
    expect(() => repository.add(offer(randomUUID(), 'player', 15, 3_333_333, 1))).toThrow();
  });
});
