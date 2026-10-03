import type { ConcessionSize, InvestorJudgment, Reaction } from '../../src/brain/InvestorJudgment.js';
import type { Judged } from '../../src/brain/Judged.js';
import type { InvestorState } from '../../src/game/InvestorState.js';
import type { PolicySettings } from '../../src/game/PolicySettings.js';
import { testConfig } from './testConfig.js';

export const settings: PolicySettings = testConfig().game.policy;
export const MIN_CONFIDENCE = 0.55;

function judged<T>(value: T, confidence = 0.9): Judged<T> {
  return { value, confidence, uncertain: confidence < MIN_CONFIDENCE };
}

/** The tutor's investor: budget €700k, equity 20–30%, step 4, interest 0.5, patience 4. */
export function investorState(overrides: Partial<InvestorState> = {}): InvestorState {
  return {
    budget: 700_000,
    minEquity: 20,
    maxEquity: 30,
    concessionStep: 4,
    interest: 0.5,
    patience: 4,
    ...overrides,
  };
}

export interface JudgmentInput {
  reaction?: Reaction;
  reactionConfidence?: number;
  accept?: number;
  goodDeal?: number;
  concession?: ConcessionSize;
  /** Adds the conduct part with this insult probability. */
  insult?: number;
}

export function judgment(input: JudgmentInput = {}): InvestorJudgment {
  const goodDeal = input.goodDeal ?? 0.5;
  const result: InvestorJudgment = {
    deal: {
      accept: judged(input.accept ?? 2),
      reaction: judged(input.reaction ?? 'counter', input.reactionConfidence ?? 0.9),
      goodDeal: { value: goodDeal, confidence: Math.max(goodDeal, 1 - goodDeal), uncertain: false },
      concessionSize: judged(input.concession ?? 'medium'),
    },
  };
  if (input.insult !== undefined) {
    result.conduct = {
      politeness: judged(2),
      insult: { value: input.insult, confidence: Math.max(input.insult, 1 - input.insult), uncertain: false },
      confidence: judged(2),
    };
  }
  return result;
}
