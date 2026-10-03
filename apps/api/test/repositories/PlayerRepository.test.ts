import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { PlayerRepository } from '../../src/repositories/PlayerRepository.js';

let database: Database;
let repository: PlayerRepository;

beforeEach(() => {
  database = new Database(':memory:');
  repository = new PlayerRepository(database.db);
});
afterEach(() => database.close());

describe('PlayerRepository', () => {
  it('creates and finds a player', () => {
    const now = new Date('2026-10-03T10:00:00.000Z');
    const player = repository.create({ id: randomUUID(), createdAt: now, lastSeenAt: now });
    expect(repository.findById(player.id)).toEqual(player);
    expect(repository.count()).toBe(1);
  });

  it('returns undefined for an unknown id', () => {
    expect(repository.findById(randomUUID())).toBeUndefined();
  });

  it('touch updates lastSeenAt only', () => {
    const created = new Date('2026-10-03T10:00:00.000Z');
    const later = new Date('2026-10-03T11:00:00.000Z');
    const player = repository.create({ id: randomUUID(), createdAt: created, lastSeenAt: created });
    repository.touch(player.id, later);
    expect(repository.findById(player.id)).toEqual({ id: player.id, createdAt: created, lastSeenAt: later });
  });
});
