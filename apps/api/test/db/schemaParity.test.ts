import { getTableColumns, getTableName, type Table } from 'drizzle-orm';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as mysql from '../../src/db/schema/mysql.js';
import * as postgres from '../../src/db/schema/postgres.js';
import * as sqlite from '../../src/db/schema/sqlite.js';

const TABLES = ['players', 'gameSessions', 'messages', 'offers', 'decisionLogs'] as const;

/** The server dialects' insertion-order column; SQLite uses its implicit rowid instead. */
const SERVER_ONLY = new Set(['seq']);

function shape(table: Table) {
  return {
    name: getTableName(table),
    columns: Object.entries(getTableColumns(table))
      .filter(([key]) => !SERVER_ONLY.has(key))
      .map(([key, column]) => ({ key, name: column.name, notNull: column.notNull }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

describe('schema parity', () => {
  it('exports the same tables from every dialect', () => {
    for (const schema of [postgres, mysql])
      expect(Object.keys(schema).sort()).toEqual(Object.keys(sqlite).sort());
  });

  it.each(TABLES)('%s has the same columns in every dialect', (table) => {
    const expected = shape(sqlite[table]);
    expect(shape(postgres[table])).toEqual(expected);
    expect(shape(mysql[table])).toEqual(expected);
  });

  it('gives every server table except players an insertion-order column', () => {
    for (const schema of [postgres, mysql]) {
      for (const table of TABLES.filter((name) => name !== 'players')) {
        expect(getTableColumns(schema[table])).toHaveProperty('seq');
      }
    }
  });

  it('reads and writes the same TypeScript types in every dialect', () => {
    type Rows<S extends typeof sqlite | typeof postgres | typeof mysql> = {
      [K in (typeof TABLES)[number]]: Omit<S[K]['$inferSelect'], 'seq'>;
    };
    type Inserts<S extends typeof sqlite | typeof postgres | typeof mysql> = {
      [K in (typeof TABLES)[number]]: Omit<S[K]['$inferInsert'], 'seq'>;
    };
    expectTypeOf<Rows<typeof postgres>>().toEqualTypeOf<Rows<typeof sqlite>>();
    expectTypeOf<Rows<typeof mysql>>().toEqualTypeOf<Rows<typeof sqlite>>();
    // SQLite's player_options has a database default (for pre-options rows), so it is optional there.
    expectTypeOf<Omit<Inserts<typeof postgres>, 'gameSessions'>>().toEqualTypeOf<
      Omit<Inserts<typeof sqlite>, 'gameSessions'>
    >();
    expectTypeOf<Omit<Inserts<typeof mysql>, 'gameSessions'>>().toEqualTypeOf<
      Omit<Inserts<typeof sqlite>, 'gameSessions'>
    >();
  });
});
