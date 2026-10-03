import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../src/db/migrations');
const GAME_TABLES = ['game_sessions', 'messages', 'offers', 'decision_logs'];

/** A migrations folder holding only the first migration, i.e. the schema before the game tables. */
function playersOnlyMigrations(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'investor-migrations-'));
  mkdirSync(path.join(folder, 'meta'));
  copyFileSync(
    path.join(MIGRATIONS, '0000_create_players.sql'),
    path.join(folder, '0000_create_players.sql'),
  );
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.tag === '0000_create_players');
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
    const old = new Database(file, playersOnlyMigrations());
    expect(tableNames(old)).not.toContain('game_sessions');
    old.sqlite.prepare('insert into players (id, created_at, last_seen_at) values (?, ?, ?)').run('p1', 1, 1);
    old.close();

    database = new Database(file);
    expect(tableNames(database)).toEqual(expect.arrayContaining(GAME_TABLES));
    expect(database.sqlite.prepare('select id from players').all()).toEqual([{ id: 'p1' }]);
  });

  it('ping throws after close', () => {
    database = new Database(':memory:');
    database.close();
    expect(() => database!.ping()).toThrow();
  });
});
