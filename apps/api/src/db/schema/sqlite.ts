import type {
  ChatRole,
  DecisionAnswer,
  DecisionQuestions,
  DecisionStage,
  GamePhase,
  GameStatus,
  Offer,
  OfferSide,
  StartupPitch,
} from '@investor/shared';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
});

// JSON columns are typed as `unknown` here; repositories parse them with their zod schema on read.

export const gameSessions = sqliteTable(
  'game_sessions',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    personaId: text('persona_id').notNull(),
    scenarioId: text('scenario_id'),
    pitch: text('pitch', { mode: 'json' }).$type<StartupPitch>().notNull(),
    status: text('status').$type<GameStatus>().notNull(),
    phase: text('phase').$type<GamePhase>().notNull(),
    turn: integer('turn').notNull(),
    currentInvestorOffer: text('current_investor_offer', { mode: 'json' }).$type<Offer>(),
    investorState: text('investor_state', { mode: 'json' }).$type<unknown>().notNull(),
    /** The player's current reply options; empty once the game ends. */
    playerOptions: text('player_options', { mode: 'json' })
      .$type<unknown>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('game_sessions_player_created_idx').on(table.playerId, table.createdAt)],
);

const sessionId = () =>
  text('session_id')
    .notNull()
    .references(() => gameSessions.id, { onDelete: 'cascade' });

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: sessionId(),
    role: text('role').$type<ChatRole>().notNull(),
    text: text('text').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('messages_session_created_idx').on(table.sessionId, table.createdAt)],
);

export const offers = sqliteTable(
  'offers',
  {
    id: text('id').primaryKey(),
    sessionId: sessionId(),
    from: text('from').$type<OfferSide>().notNull(),
    investment: integer('investment').notNull(),
    equity: real('equity').notNull(),
    impliedValuation: integer('implied_valuation').notNull(),
    turn: integer('turn').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('offers_session_turn_idx').on(table.sessionId, table.turn)],
);

export const decisionLogs = sqliteTable(
  'decision_logs',
  {
    id: text('id').primaryKey(),
    sessionId: sessionId(),
    turn: integer('turn').notNull(),
    stage: text('stage').$type<DecisionStage>().notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    questions: text('questions', { mode: 'json' }).$type<DecisionQuestions>().notNull(),
    answers: text('answers', { mode: 'json' }).$type<Record<string, DecisionAnswer>>(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('decision_logs_session_turn_idx').on(table.sessionId, table.turn)],
);
