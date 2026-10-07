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
  datetime,
  double,
  index,
  int,
  json,
  mysqlTable,
  serial,
  text,
  varchar,
} from 'drizzle-orm/mysql-core';

// Mirrors schema/sqlite.ts: same tables, same property names, same TypeScript types (a test checks this).
// MySQL cannot key or index unbounded TEXT, so ids and short strings are VARCHAR. `seq` replaces SQLite's
// implicit rowid as the tie-breaker for insertion order. DATETIME has no zone: values are stored in UTC.

const uuid = (name: string) => varchar(name, { length: 36 });
const shortText = (name: string) => varchar(name, { length: 64 });
const timestampMs = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const money = (name: string) => bigint(name, { mode: 'number' });
const seq = () => serial('seq');

export const players = mysqlTable('players', {
  id: uuid('id').primaryKey(),
  createdAt: timestampMs('created_at').notNull(),
  lastSeenAt: timestampMs('last_seen_at').notNull(),
});

export const gameSessions = mysqlTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey(),
    seq: seq(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    personaId: shortText('persona_id').notNull(),
    scenarioId: shortText('scenario_id'),
    pitch: json('pitch').$type<StartupPitch>().notNull(),
    status: shortText('status').$type<GameStatus>().notNull(),
    phase: shortText('phase').$type<GamePhase>().notNull(),
    turn: int('turn').notNull(),
    currentInvestorOffer: json('current_investor_offer').$type<Offer>(),
    investorState: json('investor_state').$type<unknown>().notNull(),
    playerOptions: json('player_options').$type<unknown>().notNull(),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [index('game_sessions_player_created_idx').on(table.playerId, table.createdAt)],
);

const sessionId = () =>
  uuid('session_id')
    .notNull()
    .references(() => gameSessions.id, { onDelete: 'cascade' });

export const messages = mysqlTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    seq: seq(),
    sessionId: sessionId(),
    role: shortText('role').$type<ChatRole>().notNull(),
    text: text('text').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [index('messages_session_created_idx').on(table.sessionId, table.createdAt)],
);

export const offers = mysqlTable(
  'offers',
  {
    id: uuid('id').primaryKey(),
    seq: seq(),
    sessionId: sessionId(),
    from: shortText('from').$type<OfferSide>().notNull(),
    investment: money('investment').notNull(),
    equity: double('equity').notNull(),
    impliedValuation: money('implied_valuation').notNull(),
    turn: int('turn').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [index('offers_session_turn_idx').on(table.sessionId, table.turn)],
);

export const decisionLogs = mysqlTable(
  'decision_logs',
  {
    id: uuid('id').primaryKey(),
    seq: seq(),
    sessionId: sessionId(),
    turn: int('turn').notNull(),
    stage: shortText('stage').$type<DecisionStage>().notNull(),
    provider: varchar('provider', { length: 128 }).notNull(),
    model: varchar('model', { length: 128 }),
    questions: json('questions').$type<DecisionQuestions>().notNull(),
    answers: json('answers').$type<Record<string, DecisionAnswer>>(),
    errorCode: shortText('error_code'),
    latencyMs: int('latency_ms').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [index('decision_logs_session_turn_idx').on(table.sessionId, table.turn)],
);
