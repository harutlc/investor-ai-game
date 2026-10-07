import type { Column } from 'drizzle-orm';

export interface ServerDialectOptions {
  url: string;
  poolMax: number;
  connectTimeoutMs: number;
  /** An idle pooled connection failed; the next query on it reports the problem. */
  onIdleError?: ((error: Error) => void) | undefined;
}

/** The `seq` column that stands in for SQLite's rowid on the server dialects. */
export function insertionOrderColumn(columns: Record<string, Column>, dialect: string): Column {
  const seq = columns.seq;
  if (!seq) throw new Error(`${dialect} table has no insertion-order (seq) column`);
  return seq;
}
