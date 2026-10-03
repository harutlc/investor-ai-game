import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { PlayerRepository } from '../../src/repositories/PlayerRepository.js';
import { PlayerService } from '../../src/services/PlayerService.js';

let database: Database;
let repository: PlayerRepository;
let now: Date;
let service: PlayerService;

beforeEach(() => {
  database = new Database(':memory:');
  repository = new PlayerRepository(database.db);
  now = new Date('2026-10-03T10:00:00.000Z');
  service = new PlayerService(repository, () => now);
});
afterEach(() => database.close());

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

describe('PlayerService.resolveOrCreate', () => {
  it('creates a player when there is no cookie', () => {
    const { player, issueCookie } = service.resolveOrCreate(undefined);
    expect(issueCookie).toBe(true);
    expect(player).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), createdAt: now, lastSeenAt: now });
    expect(repository.findById(player.id)).toEqual(player);
  });

  it('returns the existing player without re-issuing within the touch interval', () => {
    const first = service.resolveOrCreate(undefined).player;
    advance(30_000);
    const again = service.resolveOrCreate(first.id);
    expect(again).toEqual({ player: first, issueCookie: false });
    expect(repository.count()).toBe(1);
  });

  it('touches lastSeenAt and re-issues the cookie after more than a minute', () => {
    const first = service.resolveOrCreate(undefined).player;
    advance(61_000);
    const again = service.resolveOrCreate(first.id);
    expect(again.issueCookie).toBe(true);
    expect(again.player.lastSeenAt).toEqual(now);
    expect(repository.findById(first.id)?.lastSeenAt).toEqual(now);
  });

  it('creates a new player for an unknown id', () => {
    const unknown = randomUUID();
    const { player, issueCookie } = service.resolveOrCreate(unknown);
    expect(issueCookie).toBe(true);
    expect(player.id).not.toBe(unknown);
    expect(repository.findById(unknown)).toBeUndefined();
  });

  it('never looks up a malformed id', () => {
    const { player } = service.resolveOrCreate("' OR 1=1 --");
    expect(player.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
