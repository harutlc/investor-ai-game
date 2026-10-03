import type { ChatRole } from '@investor/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db/Database.js';
import { messages } from '../db/schema.js';

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  createdAt: Date;
}

/** Data access for a session's chat transcript. */
export class MessageRepository {
  constructor(private readonly db: DrizzleDb) {}

  add(message: StoredMessage): StoredMessage {
    this.db.insert(messages).values(message).run();
    return { ...message };
  }

  /** The transcript in creation order; same-millisecond messages keep their insertion order. */
  listForSession(sessionId: string): StoredMessage[] {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt), asc(sql`rowid`))
      .all();
  }
}
