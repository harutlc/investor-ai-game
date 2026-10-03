import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';

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

  it('ping throws after close', () => {
    database = new Database(':memory:');
    database.close();
    expect(() => database!.ping()).toThrow();
  });
});
