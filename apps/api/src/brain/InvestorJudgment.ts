import type { Judged } from './Judged.js';

export const REACTIONS = ['accept', 'counter', 'reject', 'walk_away'] as const;
export const CONCESSION_SIZES = ['none', 'small', 'medium', 'large'] as const;

export type Reaction = (typeof REACTIONS)[number];
export type ConcessionSize = (typeof CONCESSION_SIZES)[number];

/** Stage B's verdict on a move. Scores are expected levels 0..4 as the provider returns them. */
export interface InvestorJudgment {
  deal: {
    /** 0 = definitely reject … 4 = definitely accept (the tutor's "2/5" is 1). */
    accept: Judged<number>;
    reaction: Judged<Reaction>;
    /** Probability that the offer is attractive enough. */
    goodDeal: Judged<number>;
    concessionSize: Judged<ConcessionSize>;
  };
  /** Present only when the move had text. */
  conduct?: {
    /** 0 = rude … 4 = very polite. */
    politeness: Judged<number>;
    /** Probability that the player insulted the investor. */
    insult: Judged<number>;
    /** 0 = very unsure … 4 = very confident and professional. */
    confidence: Judged<number>;
  };
}
