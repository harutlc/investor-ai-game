import { getTableColumns, type Table } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from '../schema/postgres.js';
import type { DialectAdapter, GameDb, Tables } from './DialectAdapter.js';
import { insertionOrderColumn, type ServerDialectOptions } from './serverDialect.js';

/** A `pg` connection pool. */
export class PostgresDialect implements DialectAdapter {
  readonly dialect = 'postgres' as const;
  readonly tables = schema as unknown as Tables;
  private readonly pool: pg.Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(options: ServerDialectOptions) {
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.poolMax,
      connectionTimeoutMillis: options.connectTimeoutMs,
    });
    // An idle client losing its connection must not crash the process; the next query reports it.
    this.pool.on('error', (error) => options.onIdleError?.(error));
    this.db = drizzle({ client: this.pool, schema });
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

  affectedRows(result: unknown): number {
    return (result as pg.QueryResult).rowCount ?? 0;
  }

  insertionOrder(table: Table) {
    return insertionOrderColumn(getTableColumns(table), 'postgres');
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
