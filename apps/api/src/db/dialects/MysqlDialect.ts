import { getTableColumns, type Table } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool, type Pool, type ResultSetHeader } from 'mysql2/promise';
import * as schema from '../schema/mysql.js';
import type { DialectAdapter, GameDb, Tables } from './DialectAdapter.js';
import { insertionOrderColumn, type ServerDialectOptions } from './serverDialect.js';

/** A `mysql2` connection pool. Sessions run in UTC, as DATETIME columns carry no time zone. */
export class MysqlDialect implements DialectAdapter {
  readonly dialect = 'mysql' as const;
  readonly tables = schema as unknown as Tables;
  private readonly pool: Pool;
  private readonly db: MySql2Database<typeof schema>;

  constructor(options: ServerDialectOptions) {
    this.pool = createPool({
      uri: options.url,
      connectionLimit: options.poolMax,
      connectTimeout: options.connectTimeoutMs,
      timezone: 'Z',
    });
    this.pool.on('connection', (connection) => {
      connection.on('error', (error: Error) => options.onIdleError?.(error));
    });
    this.db = drizzle({ client: this.pool, schema, mode: 'default' });
  }

  migrate(migrationsFolder: string): Promise<void> {
    return migrate(this.db, { migrationsFolder });
  }

  async run<T>(fn: (db: GameDb) => PromiseLike<T> | T): Promise<T> {
    return fn(this.db as unknown as GameDb);
  }

  transaction<T>(fn: (tx: GameDb) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx as unknown as GameDb));
  }

  /** mysql2 reports matched rows (its default FOUND_ROWS flag), not only rows whose values changed. */
  affectedRows(result: unknown): number {
    return (result as [ResultSetHeader])[0].affectedRows;
  }

  insertionOrder(table: Table) {
    return insertionOrderColumn(getTableColumns(table), 'mysql');
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
