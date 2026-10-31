import {
  DecisionAnswerSchema,
  DecisionQuestionsSchema,
  DecisionStageSchema,
  type DecisionAnswer,
  type DecisionQuestions,
  type DecisionStage,
} from '@investor/shared';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Tables } from '../db/Database.js';

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

type Row = Tables['decisionLogs']['$inferSelect'];

const AnswersSchema = z.record(z.string(), DecisionAnswerSchema).nullable();

/** Data access for the record of every decision call made for a session. */
export class DecisionLogRepository {
  constructor(private readonly database: Database) {}

  async add(entry: DecisionLogEntry): Promise<DecisionLogEntry> {
    const { decisionLogs } = this.database.tables;
    await this.database.query((db) => db.insert(decisionLogs).values(entry));
    return structuredClone(entry);
  }

  /** Entries ordered by turn, then by creation order within a turn. */
  async listForSession(sessionId: string): Promise<DecisionLogEntry[]> {
    const { decisionLogs } = this.database.tables;
    const rows = await this.database.query((db) =>
      db
        .select()
        .from(decisionLogs)
        .where(eq(decisionLogs.sessionId, sessionId))
        .orderBy(
          asc(decisionLogs.turn),
          asc(decisionLogs.createdAt),
          asc(this.database.insertionOrder(decisionLogs)),
        ),
    );
    return rows.map((row) => DecisionLogRepository.toEntry(row));
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
