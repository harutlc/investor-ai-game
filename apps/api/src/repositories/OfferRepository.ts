import { OfferSchema, type Offer, type OfferSide } from '@investor/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db/Database.js';
import { offers } from '../db/schema.js';

export interface StoredOffer extends Offer {
  id: string;
  sessionId: string;
  createdAt: Date;
}

type Row = typeof offers.$inferSelect;

/** Data access for the offers made in a session, by either side. */
export class OfferRepository {
  constructor(private readonly db: DrizzleDb) {}

  add(offer: StoredOffer): StoredOffer {
    const { id, sessionId, createdAt, ...terms } = offer;
    this.db
      .insert(offers)
      .values({ id, sessionId, createdAt, ...OfferSchema.parse(terms) })
      .run();
    return { ...offer };
  }

  /** All offers in turn order. */
  listForSession(sessionId: string): StoredOffer[] {
    return this.db
      .select()
      .from(offers)
      .where(eq(offers.sessionId, sessionId))
      .orderBy(asc(offers.turn), asc(sql`rowid`))
      .all()
      .map((row) => OfferRepository.toOffer(row));
  }

  /** The most recent offer from one side, if it made any. */
  latest(sessionId: string, from: OfferSide): StoredOffer | undefined {
    const row = this.db
      .select()
      .from(offers)
      .where(and(eq(offers.sessionId, sessionId), eq(offers.from, from)))
      .orderBy(desc(offers.turn), desc(sql`rowid`))
      .limit(1)
      .get();
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
