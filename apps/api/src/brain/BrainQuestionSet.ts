import type { DecisionAnswer } from '@investor/shared';
import type { ParsedAppConfig } from '../config/AppConfigSchema.js';
import type { ConfidenceGate } from '../llm/decision/ConfidenceGate.js';
import type { QuestionSet } from '../llm/decision/DecisionProvider.js';
import type { InvestorJudgment } from './InvestorJudgment.js';
import type { NegotiationState } from './NegotiationState.js';
import type { PlayerMoveInterpretation } from './PlayerMoveInterpretation.js';

type GameFeatures = ParsedAppConfig['game']['features'];

/** The on/off flags in `game.features` (everything except `eventChance`). */
export type BooleanFeature = {
  [K in keyof GameFeatures]: GameFeatures[K] extends boolean ? K : never;
}[keyof GameFeatures];

export type GameFeatureFlags = Readonly<Record<BooleanFeature, boolean>>;

/** The move being judged. */
export interface BrainMove {
  state: NegotiationState;
  /** The move's text; null for a structured offer without text. */
  message: string | null;
}

/**
 * Questions ready to send, plus how to read their answers. Built per move, so anything derived from the
 * move (e.g. offer candidates) stays in the closure and the question set itself stays stateless.
 */
export interface PreparedQuestions<R> {
  questions: QuestionSet;
  interpret(answers: Readonly<Record<string, DecisionAnswer>>, gate: ConfidenceGate): R;
}

interface QuestionSetOf<S extends 'A' | 'B', R> {
  /** Unique within the registry. */
  readonly id: string;
  readonly stage: S;
  /** The flag that enables this set; always enabled when absent. */
  readonly feature?: BooleanFeature;
  /** null when the set does not apply to this move. Returns this set's part of the stage result. */
  prepare(move: BrainMove): PreparedQuestions<Partial<R>> | null;
}

export type StageAQuestionSet = QuestionSetOf<'A', PlayerMoveInterpretation>;
export type StageBQuestionSet = QuestionSetOf<'B', InvestorJudgment>;
export type BrainQuestionSet = StageAQuestionSet | StageBQuestionSet;
