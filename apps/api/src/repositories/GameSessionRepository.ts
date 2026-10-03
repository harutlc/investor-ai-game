import {
  GamePhaseSchema,
  GameStatusSchema,
  OfferSchema,
  StartupPitchSchema,
  type GamePhase,
  type GameStatus,
  type Offer,
  type StartupPitch,
} from '@investor/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DrizzleDb } from '../db/Database.js';
import { gameSessions } from '../db/schema.js';
import { InvestorStateSchema, type InvestorState } from '../game/InvestorState.js';
import type { Clock } from '../services/PlayerService.js';

export interface GameSession {
  id: string;
  playerId: string;
  personaId: string;
  scenarioId: string | null;
  pitch: StartupPitch;
  status: GameStatus;
  phase: GamePhase;
  turn: number;
  currentInvestorOffer: Offer | null;
  investorState: InvestorState;
  createdAt: Date;
  updatedAt: Date;
}

export type GameSessionUpdate = Partial<
  Pick<GameSession, 'status' | 'phase' | 'turn' | 'currentInvestorOffer' | 'investorState'>
>;

type Row = typeof gameSessions.$inferSelect;

/**
 * Data access for game sessions. Every read is scoped to the owning player, so a session can never be
 * loaded on behalf of someone else. JSON columns are validated on write and parsed again on read.
 */
export class GameSessionRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly clock: Clock = () => new Date(),
  ) {}

  create(session: GameSession): GameSession {
    this.db
      .insert(gameSessions)
      .values({
        ...session,
        pitch: StartupPitchSchema.parse(session.pitch),
        currentInvestorOffer: session.currentInvestorOffer && OfferSchema.parse(session.currentInvestorOffer),
        investorState: InvestorStateSchema.parse(session.investorState),
      })
      .run();
    return structuredClone(session);
  }

  findForPlayer(id: string, playerId: string): GameSession | undefined {
    const row = this.db
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.id, id), eq(gameSessions.playerId, playerId)))
      .get();
    return row ? GameSessionRepository.toSession(row) : undefined;
  }

  /** The player's sessions, newest first. */
  listForPlayer(playerId: string): GameSession[] {
    return this.db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.playerId, playerId))
      .orderBy(desc(gameSessions.createdAt), desc(sql`rowid`))
      .all()
      .map((row) => GameSessionRepository.toSession(row));
  }

  /** Applies `patch` and always refreshes `updatedAt`. */
  update(id: string, patch: GameSessionUpdate): void {
    this.db
      .update(gameSessions)
      .set({
        ...patch,
        ...(patch.currentInvestorOffer && {
          currentInvestorOffer: OfferSchema.parse(patch.currentInvestorOffer),
        }),
        ...(patch.investorState && { investorState: InvestorStateSchema.parse(patch.investorState) }),
        updatedAt: this.clock(),
      })
      .where(eq(gameSessions.id, id))
      .run();
  }

  /** Deletes the session; its messages, offers and decision logs go with it (FK cascade). */
  delete(id: string): void {
    this.db.delete(gameSessions).where(eq(gameSessions.id, id)).run();
  }

  private static toSession(row: Row): GameSession {
    const column = <T>(name: string, schema: z.ZodType<T>, value: unknown): T => {
      const result = schema.safeParse(value);
      if (!result.success) throw new Error(`game_sessions.${name} of session ${row.id} has an invalid shape`);
      return result.data;
    };
    return {
      id: row.id,
      playerId: row.playerId,
      personaId: row.personaId,
      scenarioId: row.scenarioId,
      pitch: column('pitch', StartupPitchSchema, row.pitch),
      status: column('status', GameStatusSchema, row.status),
      phase: column('phase', GamePhaseSchema, row.phase),
      turn: row.turn,
      currentInvestorOffer: column(
        'current_investor_offer',
        OfferSchema.nullable(),
        row.currentInvestorOffer,
      ),
      investorState: column('investor_state', InvestorStateSchema, row.investorState),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
