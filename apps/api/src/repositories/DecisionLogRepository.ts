import {
  DecisionAnswerSchema,
  DecisionQuestionsSchema,
  DecisionStageSchema,
  type DecisionAnswer,
  type DecisionQuestions,
  type DecisionStage,
} from '@investor/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DrizzleDb } from '../db/Database.js';
import { decisionLogs } from '../db/schema.js';

export interface DecisionLogEntry {
  id: string;
  sessionId: string;
  turn: number;
  stage: DecisionStage;
  provider: string;
  /** The model the backend reported; null when the call failed. */
  model: string | null;
  questions: DecisionQuestions;
  /** Null when the call failed; `errorCode` says why. */
  answers: Record<string, DecisionAnswer> | null;
  errorCode: string | null;
  latencyMs: number;
  createdAt: Date;
}

type Row = typeof decisionLogs.$inferSelect;

const AnswersSchema = z.record(z.string(), DecisionAnswerSchema).nullable();

/** Data access for the record of every decision call made for a session. */
export class DecisionLogRepository {
  constructor(private readonly db: DrizzleDb) {}

  add(entry: DecisionLogEntry): DecisionLogEntry {
    this.db.insert(decisionLogs).values(entry).run();
    return structuredClone(entry);
  }

  /** Entries ordered by turn, then by creation order within a turn. */
  listForSession(sessionId: string): DecisionLogEntry[] {
    return this.db
      .select()
      .from(decisionLogs)
      .where(eq(decisionLogs.sessionId, sessionId))
      .orderBy(asc(decisionLogs.turn), asc(decisionLogs.createdAt), asc(sql`rowid`))
      .all()
      .map((row) => DecisionLogRepository.toEntry(row));
  }

  private static toEntry(row: Row): DecisionLogEntry {
    const column = <T>(name: string, schema: z.ZodType<T>, value: unknown): T => {
      const result = schema.safeParse(value);
      if (!result.success) throw new Error(`decision_logs.${name} of entry ${row.id} has an invalid shape`);
      return result.data;
    };
    return {
      id: row.id,
      sessionId: row.sessionId,
      turn: row.turn,
      stage: column('stage', DecisionStageSchema, row.stage),
      provider: row.provider,
      model: row.model,
      questions: column('questions', DecisionQuestionsSchema, row.questions),
      answers: column('answers', AnswersSchema, row.answers),
      errorCode: row.errorCode,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt,
    };
  }
}
