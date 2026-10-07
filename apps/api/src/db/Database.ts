import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import type { SQLWrapper, Table } from 'drizzle-orm';
import type { DatabaseDialect } from '../config/AppConfigSchema.js';
import { DatabaseConnectionError } from './DatabaseConnectionError.js';
import type { DialectAdapter, GameDb, Tables } from './dialects/DialectAdapter.js';
import { MysqlDialect } from './dialects/MysqlDialect.js';
import { PostgresDialect } from './dialects/PostgresDialect.js';
import { SqliteDialect } from './dialects/SqliteDialect.js';

export type { GameDb, Tables } from './dialects/DialectAdapter.js';

/** Resolves to `apps/api/src/db/migrations` from both `src/db` (tsx) and `dist/db` (built). */
const MIGRATIONS_ROOT = path.resolve(import.meta.dirname, '../../src/db/migrations');

const CONNECT_TIMEOUT_MS = 10_000;

export interface DatabaseOptions {
  /** Defaults to `sqlite`. */
  dialect?: DatabaseDialect;
  /** SQLite file or `:memory:` (sqlite only). */
  file?: string | undefined;
  /** Connection URL (postgres and mysql only). */
  url?: string | undefined;
  poolMax?: number;
  /** Defaults to this dialect's folder under `src/db/migrations`. */
  migrationsFolder?: string;
  onIdleError?: ((error: Error) => void) | undefined;
}

/**
 * Owns the database connection(s) for the configured dialect. `open()` connects and migrates, so the schema
 * is always current. Repositories run their queries through `query()`, which joins the transaction of the
 * current async context when there is one.
 */
export class Database {
  private readonly transactions = new AsyncLocalStorage<GameDb>();

  private constructor(private readonly adapter: DialectAdapter) {}

  static async open(options: DatabaseOptions): Promise<Database> {
    const dialect = options.dialect ?? 'sqlite';
    let adapter: DialectAdapter | undefined;
    try {
      adapter = Database.adapter(dialect, options);
      await adapter.ping();
      await adapter.migrate(options.migrationsFolder ?? path.join(MIGRATIONS_ROOT, dialect));
      return new Database(adapter);
    } catch (error) {
      await adapter?.close().catch(() => undefined);
      throw new DatabaseConnectionError(dialect, options, error);
    }
  }

  private static adapter(dialect: DatabaseDialect, options: DatabaseOptions): DialectAdapter {
    if (dialect === 'sqlite') {
      if (!options.file) throw new Error('a database file is required for sqlite');
      return new SqliteDialect(options.file);
    }
    if (!options.url) throw new Error(`a connection URL is required for ${dialect}`);
    const server = {
      url: options.url,
      poolMax: options.poolMax ?? 10,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      onIdleError: options.onIdleError,
    };
    return dialect === 'postgres' ? new PostgresDialect(server) : new MysqlDialect(server);
  }

  get dialect(): DatabaseDialect {
    return this.adapter.dialect;
  }

  get tables(): Tables {
    return this.adapter.tables;
  }

  /** Raw SQLite handle, for SQLite-specific tests and diagnostics. Throws on the other dialects. */
  get sqlite(): BetterSqlite3.Database {
    if (!(this.adapter instanceof SqliteDialect)) throw new Error(`not an sqlite database (${this.dialect})`);
    return this.adapter.sqlite;
  }

  /** Runs one query, inside the current transaction if there is one. */
  query<T>(fn: (db: GameDb) => PromiseLike<T> | T): Promise<T> {
    const tx = this.transactions.getStore();
    return tx ? Promise.resolve(fn(tx)) : this.adapter.run(fn);
  }

  /**
   * Runs `fn` in one transaction: committed when it resolves, rolled back when it rejects. Every repository
   * call awaited inside `fn` is part of it. A nested call joins the outer transaction.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.transactions.getStore()) return fn();
    return this.adapter.transaction((tx) => this.transactions.run(tx, fn));
  }

  /** Rows an UPDATE or DELETE matched. */
  affectedRows(result: unknown): number {
    return this.adapter.affectedRows(result);
  }

  /** Tie-breaker that orders rows of `table` by insertion. */
  insertionOrder(table: Table): SQLWrapper {
    return this.adapter.insertionOrder(table);
  }

  /** Rejects if the database cannot answer a trivial query. */
  ping(): Promise<void> {
    return this.adapter.ping();
  }

  close(): Promise<void> {
    return this.adapter.close();
  }
}
