import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { AsyncMutex } from '../AsyncMutex.js';
import * as schema from '../schema/sqlite.js';
import type { DialectAdapter, GameDb } from './DialectAdapter.js';

const IN_MEMORY = ':memory:';

/**
 * One better-sqlite3 connection, shared by every request. A transaction spans awaits, so all access goes
 * through a mutex: another request's write can neither slip into an open transaction nor be rolled back
 * with it. Operations take microseconds, and transactions hold no network calls.
 */
export class SqliteDialect implements DialectAdapter {
  readonly dialect = 'sqlite' as const;
  readonly tables = schema;
  /** Raw driver handle, for pragmas and diagnostics. */
  readonly sqlite: BetterSqlite3.Database;
  private readonly db: GameDb;
  private readonly mutex = new AsyncMutex();

  constructor(file: string) {
    if (file !== IN_MEMORY) mkdirSync(path.dirname(file), { recursive: true });
    this.sqlite = new BetterSqlite3(file);
    if (file !== IN_MEMORY) this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle({ client: this.sqlite, schema });
  }

  migrate(migrationsFolder: string): Promise<void> {
    return this.mutex.run(() => migrate(this.db, { migrationsFolder }));
  }

  run<T>(fn: (db: GameDb) => PromiseLike<T> | T): Promise<T> {
    return this.mutex.run(() => fn(this.db));
  }

  transaction<T>(fn: (tx: GameDb) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this.db);
        this.sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        if (this.sqlite.inTransaction) this.sqlite.exec('ROLLBACK');
        throw error;
      }
    });
  }

  affectedRows(result: unknown): number {
    return (result as BetterSqlite3.RunResult).changes;
  }

  insertionOrder(): ReturnType<typeof sql> {
    return sql`rowid`;
  }

  ping(): Promise<void> {
    return this.mutex.run(() => {
      this.sqlite.prepare('select 1').get();
    });
  }

  close(): Promise<void> {
    if (this.sqlite.open) this.sqlite.close();
    return Promise.resolve();
  }
}
