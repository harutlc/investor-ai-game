import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { PlayerRepository } from '../../src/repositories/PlayerRepository.js';
import { PlayerService } from '../../src/services/PlayerService.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

let database: Database;
let repository: PlayerRepository;
let now: Date;
let service: PlayerService;

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

describe.each(dialectsUnderTest())('PlayerService.resolveOrCreate (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    repository = new PlayerRepository(database);
    now = new Date('2026-10-03T10:00:00.000Z');
    service = new PlayerService(repository, () => now);
  });
  afterEach(() => database.close());

  it('creates a player when there is no cookie', async () => {
    const { player, issueCookie } = await service.resolveOrCreate(undefined);
    expect(issueCookie).toBe(true);
    expect(player).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), createdAt: now, lastSeenAt: now });
    expect(await repository.findById(player.id)).toEqual(player);
  });

  it('returns the existing player without re-issuing within the touch interval', async () => {
    const first = (await service.resolveOrCreate(undefined)).player;
    advance(30_000);
    const again = await service.resolveOrCreate(first.id);
    expect(again).toEqual({ player: first, issueCookie: false });
    expect(await repository.count()).toBe(1);
  });

  it('touches lastSeenAt and re-issues the cookie after more than a minute', async () => {
    const first = (await service.resolveOrCreate(undefined)).player;
    advance(61_000);
    const again = await service.resolveOrCreate(first.id);
    expect(again.issueCookie).toBe(true);
    expect(again.player.lastSeenAt).toEqual(now);
    expect((await repository.findById(first.id))?.lastSeenAt).toEqual(now);
  });

  it('creates a new player for an unknown id', async () => {
    const unknown = randomUUID();
    const { player, issueCookie } = await service.resolveOrCreate(unknown);
    expect(issueCookie).toBe(true);
    expect(player.id).not.toBe(unknown);
    expect(await repository.findById(unknown)).toBeUndefined();
  });

  it('never looks up a malformed id', async () => {
    const { player } = await service.resolveOrCreate("' OR 1=1 --");
    expect(player.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
