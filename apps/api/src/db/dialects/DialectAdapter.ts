import type { SQLWrapper, Table } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DatabaseDialect } from '../../config/AppConfigSchema.js';
import type * as sqliteSchema from '../schema/sqlite.js';

/** The tables, typed by the SQLite schema; the other dialects' schemas have the same shape (a test checks it). */
export type Tables = typeof sqliteSchema;

/**
 * The query builder repositories use, typed as the SQLite builder for every dialect. Repositories stick to
 * what all three dialects share: awaiting a query (never `.get()`, `.all()` or `.run()`), no `.returning()`
 * (MySQL lacks it) and no upserts. The persistence tests run on every dialect to hold them to that.
 */
export type GameDb = BetterSQLite3Database<Tables>;

/** What differs between SQLite, PostgreSQL and MySQL; `Database` hides it from the rest of the app. */
export interface DialectAdapter {
  readonly dialect: DatabaseDialect;
  readonly tables: Tables;
  migrate(migrationsFolder: string): Promise<void>;
  /** Runs `fn` outside any transaction. */
  run<T>(fn: (db: GameDb) => PromiseLike<T> | T): Promise<T>;
  /** Runs `fn` in one transaction: committed when it resolves, rolled back when it rejects. */
  transaction<T>(fn: (tx: GameDb) => Promise<T>): Promise<T>;
  /** Rows an UPDATE or DELETE matched, from the driver's result. */
  affectedRows(result: unknown): number;
  /** Orders rows of `table` by insertion, as a tie-breaker for equal timestamps or turns. */
  insertionOrder(table: Table): SQLWrapper;
  ping(): Promise<void>;
  close(): Promise<void>;
}
