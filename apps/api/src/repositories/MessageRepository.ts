import type { ChatRole } from '@investor/shared';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/Database.js';

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  createdAt: Date;
}

/** Data access for a session's chat transcript. */
export class MessageRepository {
  constructor(private readonly database: Database) {}

  async add(message: StoredMessage): Promise<StoredMessage> {
    const { messages } = this.database.tables;
    await this.database.query((db) => db.insert(messages).values(message));
    return { ...message };
  }

  /** The transcript in creation order; same-millisecond messages keep their insertion order. */
  async listForSession(sessionId: string): Promise<StoredMessage[]> {
    const { messages } = this.database.tables;
    const rows = await this.database.query((db) =>
      db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.createdAt), asc(this.database.insertionOrder(messages))),
    );
    return rows.map(({ id, sessionId: session, role, text, createdAt }) => ({
      id,
      sessionId: session,
      role,
      text,
      createdAt,
    }));
  }
}
