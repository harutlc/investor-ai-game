import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import pg from 'pg';
import type { DatabaseDialect } from '../../src/config/AppConfigSchema.js';
import { Database, type DatabaseOptions } from '../../src/db/Database.js';

/** Server URLs for the extra dialects; see docker-compose.test-db.yml. */
const SERVER_URLS: Partial<Record<DatabaseDialect, string | undefined>> = {
  postgres: process.env.TEST_POSTGRES_URL,
  mysql: process.env.TEST_MYSQL_URL,
};

/** SQLite always; PostgreSQL and MySQL when TEST_POSTGRES_URL / TEST_MYSQL_URL are set. */
export function dialectsUnderTest(): DatabaseDialect[] {
  return ['sqlite', ...(['postgres', 'mysql'] as const).filter((dialect) => SERVER_URLS[dialect])];
}

/** The server URL of a dialect under test (throws for sqlite or an unset URL). */
export function serverUrl(dialect: DatabaseDialect): string {
  const url = SERVER_URLS[dialect];
  if (!url) throw new Error(`no test server URL for ${dialect}`);
  return url;
}

/**
 * A migrated, empty database of `dialect`: in-memory for SQLite, otherwise a uniquely named database on
 * the test server that `close()` drops again.
 */
export async function openTestDatabase(
  dialect: DatabaseDialect = 'sqlite',
  options: Pick<DatabaseOptions, 'migrationsFolder' | 'file'> = {},
): Promise<Database> {
  if (dialect === 'sqlite') return Database.open({ file: ':memory:', ...options });

  const adminUrl = serverUrl(dialect);
  const name = `investor_test_${randomBytes(6).toString('hex')}`;
  await admin(dialect, adminUrl, `create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  let database: Database;
  try {
    database = await Database.open({ dialect, url: url.toString(), ...options });
  } catch (error) {
    await admin(dialect, adminUrl, `drop database ${name}`);
    throw error;
  }
  const close = database.close.bind(database);
  let closed = false;
  database.close = async () => {
    if (closed) return;
    closed = true;
    await close();
    await admin(
      dialect,
      adminUrl,
      dialect === 'postgres' ? `drop database ${name} with (force)` : `drop database ${name}`,
    );
  };
  return database;
}

async function admin(dialect: DatabaseDialect, url: string, statement: string): Promise<void> {
  if (dialect === 'postgres') {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
    return;
  }
  const connection = await createConnection({ uri: url });
  try {
    await connection.query(statement);
  } finally {
    await connection.end();
  }
}
