import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { asc } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { DatabaseConnectionError } from '../../src/db/DatabaseConnectionError.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { sessionFixture } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase, serverUrl } from '../support/testDatabase.js';

const MIGRATIONS = path.resolve(import.meta.dirname, '../../src/db/migrations/sqlite');
const GAME_TABLES = ['game_sessions', 'messages', 'offers', 'decision_logs'];

/** A migrations folder holding only the first `count` SQLite migrations, i.e. an older schema. */
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

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'investor-db-')), 'game.sqlite');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let database: Database | undefined;
afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe.each(dialectsUnderTest())('Database (%s)', (dialect) => {
  const playerIds = async (db: Database) =>
    (await db.query((q) => q.select().from(db.tables.players).orderBy(asc(db.tables.players.id)))).map(
      (row) => row.id,
    );
  const insertPlayer = (db: Database, id: string) =>
    db.query((q) =>
      q.insert(db.tables.players).values({ id, createdAt: new Date(1), lastSeenAt: new Date(1) }),
    );

  it('migrates an empty database and answers ping', async () => {
    database = await openTestDatabase(dialect);
    await expect(database.ping()).resolves.toBeUndefined();
    for (const table of Object.values(database.tables)) {
      await expect(database.query((q) => q.select().from(table).limit(1))).resolves.toEqual([]);
    }
  });

  it('commits a transaction and rolls one back when it rejects', async () => {
    database = await openTestDatabase(dialect);
    const db = database;
    await db.transaction(() => insertPlayer(db, 'kept').then(() => undefined));
    await expect(
      db.transaction(async () => {
        await insertPlayer(db, 'dropped');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await playerIds(db)).toEqual(['kept']);
  });

  it('keeps a concurrent write outside the transaction when it rolls back', async () => {
    database = await openTestDatabase(dialect);
    const db = database;
    let releaseTx!: () => void;
    const txMayFinish = new Promise<void>((resolve) => (releaseTx = resolve));
    const tx = db.transaction(async () => {
      await insertPlayer(db, 'in-tx');
      await txMayFinish;
      throw new Error('rollback');
    });
    await delay(20);
    let outsideDone = false;
    const outside = insertPlayer(db, 'outside').then(() => (outsideDone = true));
    await delay(20);
    // SQLite shares one connection, so the outside write waits; a server runs it on another connection.
    if (dialect === 'sqlite') expect(outsideDone).toBe(false);
    releaseTx();
    await expect(tx).rejects.toThrow('rollback');
    await outside;
    expect(await playerIds(db)).toEqual(['outside']);
  });

  it('joins the outer transaction from a nested call', async () => {
    database = await openTestDatabase(dialect);
    const db = database;
    await expect(
      db.transaction(async () => {
        await db.transaction(() => insertPlayer(db, 'inner').then(() => undefined));
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await playerIds(db)).toEqual([]);
  });

  it('enforces foreign keys', async () => {
    database = await openTestDatabase(dialect);
    const db = database;
    await expect(
      db.query((q) =>
        q.insert(db.tables.gameSessions).values({ ...sessionFixture('nobody'), playerOptions: [] }),
      ),
    ).rejects.toThrow();
  });

  it('ping rejects after close', async () => {
    database = await openTestDatabase(dialect);
    await database.close();
    await expect(database.ping()).rejects.toThrow();
  });
});

describe('Database (sqlite)', () => {
  it('creates missing parent directories for file databases and enables WAL', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'investor-db-')), 'nested/dir/game.sqlite');
    database = await Database.open({ file });
    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('creates the game tables', async () => {
    database = await openTestDatabase();
    expect(tableNames(database)).toEqual(expect.arrayContaining(GAME_TABLES));
  });

  it('adds the game tables to an existing database and keeps its players', async () => {
    const file = tempFile();
    const old = await Database.open({ file, migrationsFolder: migrationsUpTo(1) });
    expect(tableNames(old)).not.toContain('game_sessions');
    old.sqlite.prepare('insert into players (id, created_at, last_seen_at) values (?, ?, ?)').run('p1', 1, 1);
    await old.close();

    database = await Database.open({ file });
    expect(tableNames(database)).toEqual(expect.arrayContaining(GAME_TABLES));
    expect(database.sqlite.prepare('select id from players').all()).toEqual([{ id: 'p1' }]);
  });

  it('gives sessions stored before 0002 an empty option list', async () => {
    const file = tempFile();
    const old = await Database.open({ file, migrationsFolder: migrationsUpTo(2) });
    old.sqlite.prepare('insert into players (id, created_at, last_seen_at) values (?, ?, ?)').run('p1', 1, 1);
    const session = sessionFixture('p1');
    old.sqlite
      .prepare(
        `insert into game_sessions (id, player_id, persona_id, pitch, status, phase, turn, investor_state, created_at, updated_at)
         values (?, 'p1', 'greedy-shark', ?, 'negotiating', 'term_negotiation', 0, ?, 1, 1)`,
      )
      .run(session.id, JSON.stringify(session.pitch), JSON.stringify(session.investorState));
    await old.close();

    database = await Database.open({ file });
    expect(
      (await new GameSessionRepository(database).findForPlayer(session.id, 'p1'))?.playerOptions,
    ).toEqual([]);
  });

  it('reopens a database written by the previous release without new migrations', async () => {
    const file = tempFile();
    // The previous release applied the same three migrations from src/db/migrations (now .../sqlite).
    const old = await Database.open({ file, migrationsFolder: migrationsUpTo(3) });
    old.sqlite.prepare('insert into players (id, created_at, last_seen_at) values (?, ?, ?)').run('p1', 1, 1);
    const applied = old.sqlite.prepare('select hash, created_at from __drizzle_migrations').all();
    await old.close();

    database = await Database.open({ file });
    expect(database.sqlite.prepare('select hash, created_at from __drizzle_migrations').all()).toEqual(
      applied,
    );
    expect(database.sqlite.prepare('select id from players').all()).toEqual([{ id: 'p1' }]);
  });

  it('wraps a failure to open in a DatabaseConnectionError', async () => {
    const error = await Database.open({ file: '/dev/null/not-a-dir/game.sqlite' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseConnectionError);
    expect((error as Error).message).toContain('could not open the sqlite database');
  });
});

describe.each(['postgres', 'mysql'] as const)('Database (%s connection failures)', (dialect) => {
  const scheme = dialect === 'postgres' ? 'postgres' : 'mysql';

  it('rejects an unreachable server without printing the password', async () => {
    const error = await Database.open({ dialect, url: `${scheme}://game:s3cret@127.0.0.1:1/game` }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DatabaseConnectionError);
    expect((error as Error).message).toContain(`could not open the ${dialect} database at 127.0.0.1:1`);
    expect((error as Error).message).not.toContain('s3cret');
  });

  it.runIf(dialectsUnderTest().includes(dialect))(
    'rejects wrong credentials without printing them',
    async () => {
      const url = new URL(serverUrl(dialect));
      url.password = 'wr0ng-s3cret';
      const error = await Database.open({ dialect, url: url.toString() }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DatabaseConnectionError);
      expect((error as Error).message).not.toContain('wr0ng-s3cret');
    },
  );
});
