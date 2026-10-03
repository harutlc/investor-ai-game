import { count, eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/Database.js';
import { players } from '../db/schema.js';

export interface Player {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/** Data access for anonymous players. No business rules here. */
export class PlayerRepository {
  constructor(private readonly db: DrizzleDb) {}

  findById(id: string): Player | undefined {
    const row = this.db.select().from(players).where(eq(players.id, id)).get();
    return row ? { id: row.id, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt } : undefined;
  }

  create(player: Player): Player {
    this.db.insert(players).values(player).run();
    return { ...player };
  }

  touch(id: string, at: Date): void {
    this.db.update(players).set({ lastSeenAt: at }).where(eq(players.id, id)).run();
  }

  count(): number {
    return this.db.select({ value: count() }).from(players).get()?.value ?? 0;
  }
}
