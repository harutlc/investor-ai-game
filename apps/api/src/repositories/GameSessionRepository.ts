import {
  GamePhaseSchema,
  GameStatusSchema,
  OfferSchema,
  PlayerOptionSchema,
  StartupPitchSchema,
  type GamePhase,
  type GameStatus,
  type Offer,
  type PlayerOption,
  type StartupPitch,
} from '@investor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Tables } from '../db/Database.js';
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
  /** The player's current reply options; empty once the game ends. */
  playerOptions: PlayerOption[];
  createdAt: Date;
  updatedAt: Date;
}

export type GameSessionUpdate = Partial<
  Pick<GameSession, 'status' | 'phase' | 'turn' | 'currentInvestorOffer' | 'investorState' | 'playerOptions'>
>;

const PlayerOptionsSchema = z.array(PlayerOptionSchema);

type Row = Tables['gameSessions']['$inferSelect'];

/**
 * Data access for game sessions. Every read is scoped to the owning player, so a session can never be
 * loaded on behalf of someone else. JSON columns are validated on write and parsed again on read.
 */
export class GameSessionRepository {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async create(session: GameSession): Promise<GameSession> {
    const { gameSessions } = this.database.tables;
    const values = {
      ...session,
      pitch: StartupPitchSchema.parse(session.pitch),
      currentInvestorOffer: session.currentInvestorOffer && OfferSchema.parse(session.currentInvestorOffer),
      investorState: InvestorStateSchema.parse(session.investorState),
      playerOptions: PlayerOptionsSchema.parse(session.playerOptions),
    };
    await this.database.query((db) => db.insert(gameSessions).values(values));
    return structuredClone(session);
  }

  async findForPlayer(id: string, playerId: string): Promise<GameSession | undefined> {
    const { gameSessions } = this.database.tables;
    const [row] = await this.database.query((db) =>
      db
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.id, id), eq(gameSessions.playerId, playerId)))
        .limit(1),
    );
    return row ? GameSessionRepository.toSession(row) : undefined;
  }

  /** The player's sessions, newest first. */
  async listForPlayer(playerId: string): Promise<GameSession[]> {
    const { gameSessions } = this.database.tables;
    const rows = await this.database.query((db) =>
      db
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.playerId, playerId))
        .orderBy(desc(gameSessions.createdAt), desc(this.database.insertionOrder(gameSessions))),
    );
    return rows.map((row) => GameSessionRepository.toSession(row));
  }

  /**
   * Applies `patch` and always refreshes `updatedAt`. With `expectedTurn`, only a session still on that turn
   * is updated, so a concurrent writer cannot be overwritten. Returns whether a row changed.
   */
  async update(
    id: string,
    patch: GameSessionUpdate,
    options: { expectedTurn?: number } = {},
  ): Promise<boolean> {
    const { gameSessions } = this.database.tables;
    const match =
      options.expectedTurn === undefined
        ? eq(gameSessions.id, id)
        : and(eq(gameSessions.id, id), eq(gameSessions.turn, options.expectedTurn));
    const values = {
      ...patch,
      ...(patch.currentInvestorOffer && {
        currentInvestorOffer: OfferSchema.parse(patch.currentInvestorOffer),
      }),
      ...(patch.investorState && { investorState: InvestorStateSchema.parse(patch.investorState) }),
      ...(patch.playerOptions && { playerOptions: PlayerOptionsSchema.parse(patch.playerOptions) }),
      updatedAt: this.clock(),
    };
    const result = await this.database.query((db) => db.update(gameSessions).set(values).where(match));
    return this.database.affectedRows(result) > 0;
  }

  /** Deletes the session; its messages, offers and decision logs go with it (FK cascade). */
  async delete(id: string): Promise<void> {
    const { gameSessions } = this.database.tables;
    await this.database.query((db) => db.delete(gameSessions).where(eq(gameSessions.id, id)));
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
      playerOptions: column('player_options', PlayerOptionsSchema, row.playerOptions),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
