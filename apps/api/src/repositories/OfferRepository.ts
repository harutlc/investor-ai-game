import { OfferSchema, type Offer, type OfferSide } from '@investor/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database, Tables } from '../db/Database.js';

export interface StoredOffer extends Offer {
  id: string;
  sessionId: string;
  createdAt: Date;
}

type Row = Tables['offers']['$inferSelect'];

/** Data access for the offers made in a session, by either side. */
export class OfferRepository {
  constructor(private readonly database: Database) {}

  async add(offer: StoredOffer): Promise<StoredOffer> {
    const { offers } = this.database.tables;
    const { id, sessionId, createdAt, ...terms } = offer;
    await this.database.query((db) =>
      db.insert(offers).values({ id, sessionId, createdAt, ...OfferSchema.parse(terms) }),
    );
    return { ...offer };
  }

  /** All offers in turn order. */
  async listForSession(sessionId: string): Promise<StoredOffer[]> {
    const { offers } = this.database.tables;
    const rows = await this.database.query((db) =>
      db
        .select()
        .from(offers)
        .where(eq(offers.sessionId, sessionId))
        .orderBy(asc(offers.turn), asc(this.database.insertionOrder(offers))),
    );
    return rows.map((row) => OfferRepository.toOffer(row));
  }

  /** The most recent offer from one side, if it made any. */
  async latest(sessionId: string, from: OfferSide): Promise<StoredOffer | undefined> {
    const { offers } = this.database.tables;
    const [row] = await this.database.query((db) =>
      db
        .select()
        .from(offers)
        .where(and(eq(offers.sessionId, sessionId), eq(offers.from, from)))
        .orderBy(desc(offers.turn), desc(this.database.insertionOrder(offers)))
        .limit(1),
    );
    return row ? OfferRepository.toOffer(row) : undefined;
  }

  private static toOffer(row: Row): StoredOffer {
    return {
      id: row.id,
      sessionId: row.sessionId,
      from: row.from,
      investment: row.investment,
      equity: row.equity,
      impliedValuation: row.impliedValuation,
      turn: row.turn,
      createdAt: row.createdAt,
    };
  }
}
