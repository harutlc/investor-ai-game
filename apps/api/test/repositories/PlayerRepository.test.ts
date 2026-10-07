import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { PlayerRepository } from '../../src/repositories/PlayerRepository.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

let database: Database;
let repository: PlayerRepository;

describe.each(dialectsUnderTest())('PlayerRepository (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    repository = new PlayerRepository(database);
  });
  afterEach(() => database.close());

  it('creates and finds a player', async () => {
    const now = new Date('2026-10-03T10:00:00.000Z');
    const player = await repository.create({ id: randomUUID(), createdAt: now, lastSeenAt: now });
    expect(await repository.findById(player.id)).toEqual(player);
    expect(await repository.count()).toBe(1);
  });

  it('returns undefined for an unknown id', async () => {
    expect(await repository.findById(randomUUID())).toBeUndefined();
  });

  it('touch updates lastSeenAt only', async () => {
    const created = new Date('2026-10-03T10:00:00.000Z');
    const later = new Date('2026-10-03T11:00:00.000Z');
    const player = await repository.create({ id: randomUUID(), createdAt: created, lastSeenAt: created });
    await repository.touch(player.id, later);
    expect(await repository.findById(player.id)).toEqual({
      id: player.id,
      createdAt: created,
      lastSeenAt: later,
    });
  });
});
