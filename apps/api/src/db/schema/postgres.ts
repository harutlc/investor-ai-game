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
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Mirrors schema/sqlite.ts: same tables, same property names, same TypeScript types (a test checks this).
// `seq` replaces SQLite's implicit rowid as the tie-breaker for insertion order.

const timestampMs = (name: string) => timestamp(name, { mode: 'date', precision: 3, withTimezone: true });
const money = (name: string) => bigint(name, { mode: 'number' });
const seq = () => bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity();

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  createdAt: timestampMs('created_at').notNull(),
  lastSeenAt: timestampMs('last_seen_at').notNull(),
});

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: text('id').primaryKey(),
    seq: seq(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    personaId: text('persona_id').notNull(),
    scenarioId: text('scenario_id'),
    pitch: jsonb('pitch').$type<StartupPitch>().notNull(),
    status: text('status').$type<GameStatus>().notNull(),
    phase: text('phase').$type<GamePhase>().notNull(),
    turn: integer('turn').notNull(),
    currentInvestorOffer: jsonb('current_investor_offer').$type<Offer>(),
    investorState: jsonb('investor_state').$type<unknown>().notNull(),
    playerOptions: jsonb('player_options').$type<unknown>().notNull(),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [index('game_sessions_player_created_idx').on(table.playerId, table.createdAt)],
);

const sessionId = () =>
  text('session_id')
    .notNull()
    .references(() => gameSessions.id, { onDelete: 'cascade' });

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    seq: seq(),
    sessionId: sessionId(),
    role: text('role').$type<ChatRole>().notNull(),
    text: text('text').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [index('messages_session_created_idx').on(table.sessionId, table.createdAt)],
);

export const offers = pgTable(
  'offers',
  {
    id: text('id').primaryKey(),
    seq: seq(),
    sessionId: sessionId(),
    from: text('from').$type<OfferSide>().notNull(),
    investment: money('investment').notNull(),
    equity: doublePrecision('equity').notNull(),
    impliedValuation: money('implied_valuation').notNull(),
    turn: integer('turn').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [index('offers_session_turn_idx').on(table.sessionId, table.turn)],
);

export const decisionLogs = pgTable(
  'decision_logs',
  {
    id: text('id').primaryKey(),
    seq: seq(),
    sessionId: sessionId(),
    turn: integer('turn').notNull(),
    stage: text('stage').$type<DecisionStage>().notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    questions: jsonb('questions').$type<DecisionQuestions>().notNull(),
    answers: jsonb('answers').$type<Record<string, DecisionAnswer>>(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [index('decision_logs_session_turn_idx').on(table.sessionId, table.turn)],
);
