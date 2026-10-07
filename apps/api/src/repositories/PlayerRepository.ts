import { count, eq } from 'drizzle-orm';
import type { Database } from '../db/Database.js';

export interface Player {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/** Data access for anonymous players. No business rules here. */
export class PlayerRepository {
  constructor(private readonly database: Database) {}

  async findById(id: string): Promise<Player | undefined> {
    const { players } = this.database.tables;
    const [row] = await this.database.query((db) =>
      db.select().from(players).where(eq(players.id, id)).limit(1),
    );
    return row ? { id: row.id, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt } : undefined;
  }

  async create(player: Player): Promise<Player> {
    const { players } = this.database.tables;
    await this.database.query((db) => db.insert(players).values(player));
    return { ...player };
  }

  async touch(id: string, at: Date): Promise<void> {
    const { players } = this.database.tables;
    await this.database.query((db) => db.update(players).set({ lastSeenAt: at }).where(eq(players.id, id)));
  }

  async count(): Promise<number> {
    const { players } = this.database.tables;
    const [row] = await this.database.query((db) => db.select({ value: count() }).from(players));
    // PostgreSQL returns count() as a string-typed bigint.
    return Number(row?.value ?? 0);
  }
}
