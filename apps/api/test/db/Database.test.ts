import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { sessionFixture } from '../support/gameFixtures.js';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../src/db/migrations');
const GAME_TABLES = ['game_sessions', 'messages', 'offers', 'decision_logs'];

/** A migrations folder holding only the first `count` migrations, i.e. an older schema. */
function migrationsUpTo(count: number): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'investor-migrations-'));
  mkdirSync(path.join(folder, 'meta'));
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.slice(0, count);
  for (const { tag } of journal.entries) {
    copyFileSync(path.join(MIGRATIONS, `${tag}.sql`), path.join(folder, `${tag}.sql`));
  }
  writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  return folder;
}

function tableNames(db: Database): string[] {
  return db.sqlite
    .prepare("select name from sqlite_master where type = 'table'")
    .all()
    .map((row) => (row as { name: string }).name);
}

let database: Database | undefined;
afterEach(() => database?.close());

describe('Database', () => {
  it('migrates an in-memory database and answers ping', () => {
    database = new Database(':memory:');
    expect(() => database!.ping()).not.toThrow();
    expect(database.sqlite.prepare("select name from sqlite_master where name = 'players'").get()).toEqual({
      name: 'players',
    });
  });

  it('creates missing parent directories for file databases and enables WAL', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'investor-db-')), 'nested/dir/game.sqlite');
    database = new Database(file);
    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('creates the game tables', () => {
    database = new Database(':memory:');
    expect(tableNames(database)).toEqual(expect.arrayContaining(GAME_TABLES));
  });

  it('adds the game tables to an existing database and keeps its players', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'investor-db-')), 'game.sqlite');
    const old = new Database(file, migrationsUpTo(1));
    expect(tableNames(old)).not.toContain('game_sessions');
    old.sqlite.prepare('insert into players (id, created_at, last_seen_at) values (?, ?, ?)').run('p1', 1, 1);
    old.close();

    database = new Database(file);
    expect(tableNames(database)).toEqual(expect.arrayContaining(GAME_TABLES));
    expect(database.sqlite.prepare('select id from players').all()).toEqual([{ id: 'p1' }]);
  });

  it('gives sessions stored before 0002 an empty option list', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'investor-db-')), 'game.sqlite');
    const old = new Database(file, migrationsUpTo(2));
    old.sqlite.prepare('insert into players (id, created_at, last_seen_at) values (?, ?, ?)').run('p1', 1, 1);
    const session = sessionFixture('p1');
    old.sqlite
      .prepare(
        `insert into game_sessions (id, player_id, persona_id, pitch, status, phase, turn, investor_state, created_at, updated_at)
         values (?, 'p1', 'greedy-shark', ?, 'negotiating', 'term_negotiation', 0, ?, 1, 1)`,
      )
      .run(session.id, JSON.stringify(session.pitch), JSON.stringify(session.investorState));
    old.close();

    database = new Database(file);
    expect(new GameSessionRepository(database.db).findForPlayer(session.id, 'p1')?.playerOptions).toEqual([]);
  });

  it('commits a transaction and rolls one back when it throws', () => {
    database = new Database(':memory:');
    const insert = database.sqlite.prepare(
      'insert into players (id, created_at, last_seen_at) values (?, 1, 1)',
    );
    database.transaction(() => insert.run('kept'));
    expect(() =>
      database!.transaction(() => {
        insert.run('dropped');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(database.sqlite.prepare('select id from players').all()).toEqual([{ id: 'kept' }]);
  });

  it('ping throws after close', () => {
    database = new Database(':memory:');
    database.close();
    expect(() => database!.ping()).toThrow();
  });
});
