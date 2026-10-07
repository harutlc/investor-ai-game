import {
  DecisionQuestionsSchema,
  DecisionStateSchema,
  type ChoiceAnswer,
  type DecisionState,
  type NoulAnswer,
  type ScoreAnswer,
} from '@investor/shared';
import type { DECISION_PROVIDERS } from '../../config/AppConfigSchema.js';
import { ValidationError } from '../../errors/ValidationError.js';

export type DecisionProviderName = (typeof DECISION_PROVIDERS)[number];

type Entry = string | Readonly<Record<string, unknown>> | readonly unknown[];

/**
 * Question shapes accepted by providers. Readonly so question sets can be declared `as const`, which keeps
 * choice labels literal for typed answers; the runtime check is DecisionQuestionsSchema (with limits).
 */
export type QuestionInput =
  | {
      readonly type: 'choice';
      readonly instructions: Entry;
      readonly criteria: Readonly<Record<string, Entry | null>>;
    }
  | {
      readonly type: 'noul';
      readonly instructions: Entry;
      readonly criteria?:
        { readonly true?: Entry | undefined; readonly false?: Entry | undefined } | undefined;
    }
  | { readonly type: 'score'; readonly instructions: Entry; readonly criteria: readonly Entry[] };

export type QuestionSet = Readonly<Record<string, QuestionInput>>;

/** The answer type for a question; choice answers carry the question's labels as a union. */
export type AnswerFor<Q extends QuestionInput> = Q extends { type: 'choice'; criteria: infer C }
  ? ChoiceAnswer<Extract<keyof C, string>>
  : Q extends { type: 'noul' }
    ? NoulAnswer
    : ScoreAnswer;

export interface DecisionRequest<Q extends QuestionSet = QuestionSet> {
  state: DecisionState | Readonly<Record<string, unknown>>;
  questions: Q;
}

export interface DecisionResult<Q extends QuestionSet = QuestionSet> {
  provider: DecisionProviderName;
  /** The model the backend reports having used. */
  model: string;
  answers: { [K in keyof Q]: AnswerFor<Q[K]> };
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

/**
 * The decision LLM, the investor's brain: typed System One judgments (choice / noul / score).
 * Independent questions over the same state belong in one request; they are answered in parallel.
 */
export interface DecisionProvider {
  readonly name: DecisionProviderName;
  decide<const Q extends QuestionSet>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>>;
  /** Runs independent requests concurrently; results come back in request order. */
  decideMany(requests: readonly DecisionRequest[]): Promise<DecisionResult[]>;
  /** Resolves when the backend answers (and, for Jev, accepts the key); throws otherwise. */
  ping(): Promise<void>;
}

/** Rejects malformed state or questions (limits included) before anything is sent. */
export function validateDecisionRequest(request: DecisionRequest): void {
  // `state` is typed by its schema; questions arrive as QuestionSet and are checked here.
  const issues = [
    ...prefixIssues('state', DecisionStateSchema.safeParse(request.state).error),
    ...prefixIssues('questions', DecisionQuestionsSchema.safeParse(request.questions).error),
  ];
  if (issues.length > 0) throw new ValidationError(issues, 'Invalid decision request');
}

function prefixIssues(
  prefix: string,
  error: { issues: { path: PropertyKey[]; message: string }[] } | undefined,
) {
  return (error?.issues ?? []).map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}
