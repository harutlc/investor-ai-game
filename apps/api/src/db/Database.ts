import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type DrizzleDb = BetterSQLite3Database<Schema>;

const IN_MEMORY = ':memory:';

/** Resolves to `apps/api/src/db/migrations` from both `src/db` (tsx) and `dist/db` (built). */
const DEFAULT_MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../src/db/migrations');

/** Owns the SQLite connection. Migrates on construction so the schema is always current. */
export class Database {
  readonly db: DrizzleDb;
  /** Raw driver handle, for pragmas and diagnostics. Application code uses `db`. */
  readonly sqlite: BetterSqlite3.Database;

  constructor(file: string, migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER) {
    if (file !== IN_MEMORY) mkdirSync(path.dirname(file), { recursive: true });
    this.sqlite = new BetterSqlite3(file);
    if (file !== IN_MEMORY) this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle({ client: this.sqlite, schema });
    migrate(this.db, { migrationsFolder });
  }

  /** Throws if the database cannot answer a trivial query. */
  ping(): void {
    this.sqlite.prepare('select 1').get();
  }

  close(): void {
    if (this.sqlite.open) this.sqlite.close();
  }
}
