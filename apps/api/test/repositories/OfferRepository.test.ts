import { randomUUID } from 'node:crypto';
import type { OfferSide } from '@investor/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { OfferRepository } from '../../src/repositories/OfferRepository.js';
import { T0, seedSession } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

let database: Database;
let repository: OfferRepository;

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

describe.each(dialectsUnderTest())('OfferRepository (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    repository = new OfferRepository(database);
  });
  afterEach(() => database.close());

  it('returns the latest offer from each side', async () => {
    const session = await seedSession(database);
    await repository.add(offer(session.id, 'investor', 30, 1_666_667, 0));
    await repository.add(offer(session.id, 'player', 15, 3_333_333, 1));
    const latestInvestor = await repository.add(offer(session.id, 'investor', 24, 2_083_333, 2));

    expect(await repository.latest(session.id, 'investor')).toEqual(latestInvestor);
    expect((await repository.latest(session.id, 'player'))?.equity).toBe(15);
  });

  it('returns undefined when a side has not offered yet', async () => {
    const session = await seedSession(database);
    expect(await repository.latest(session.id, 'player')).toBeUndefined();
  });

  it('lists offers in turn order', async () => {
    const session = await seedSession(database);
    await repository.add(offer(session.id, 'investor', 24, 2_083_333, 2));
    await repository.add(offer(session.id, 'investor', 30, 1_666_667, 0));
    await repository.add(offer(session.id, 'player', 15, 3_333_333, 1));
    expect((await repository.listForSession(session.id)).map((o) => o.turn)).toEqual([0, 1, 2]);
  });

  it('rejects an inconsistent implied valuation', async () => {
    const session = await seedSession(database);
    await expect(repository.add(offer(session.id, 'player', 15, 2_000_000, 1))).rejects.toThrow();
  });

  it('refuses an offer for an unknown session', async () => {
    await expect(repository.add(offer(randomUUID(), 'player', 15, 3_333_333, 1))).rejects.toThrow();
  });
});
