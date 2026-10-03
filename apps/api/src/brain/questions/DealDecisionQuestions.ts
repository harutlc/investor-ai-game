import type { BrainMove, PreparedQuestions, StageBQuestionSet } from '../BrainQuestionSet.js';
import { CONCESSION_SIZES, REACTIONS, type InvestorJudgment } from '../InvestorJudgment.js';
import { judgeChoice, judgeNoul, judgeScore } from '../Judged.js';

/** The tutor's questions, plus how far to move when countering. */
const QUESTIONS = {
  accept: {
    type: 'score',
    instructions: "How likely is the investor to accept the player's offer?",
    criteria: ['Definitely reject', 'Probably reject', 'Uncertain', 'Probably accept', 'Definitely accept'],
  },
  reaction: {
    type: 'choice',
    instructions: 'How should the investor react?',
    criteria: {
      accept: 'Accept the offer',
      counter: 'Make a counter-offer',
      reject: 'Reject the offer',
      walk_away: 'End the negotiation',
    },
  },
  good_deal: {
    type: 'noul',
    instructions: "The player's offer is attractive enough for the investor.",
  },
  concession_size: {
    type: 'choice',
    instructions: "If the investor counters, how far should they move toward the player's position?",
    criteria: {
      none: 'Hold the current offer',
      small: 'A small step toward the player',
      medium: 'A moderate step toward the player',
      large: 'A big step toward the player',
    },
  },
} as const;

/** Stage B: the investor's verdict on the deal. Always asked. */
export class DealDecisionQuestions implements StageBQuestionSet {
  readonly id = 'deal';
  readonly stage = 'B';

  prepare(_move: BrainMove): PreparedQuestions<Partial<InvestorJudgment>> {
    return {
      questions: QUESTIONS,
      interpret: (answers, gate) => ({
        deal: {
          accept: judgeScore(answers, 'accept', gate),
          reaction: judgeChoice(answers, 'reaction', REACTIONS, gate),
          goodDeal: judgeNoul(answers, 'good_deal', gate),
          concessionSize: judgeChoice(answers, 'concession_size', CONCESSION_SIZES, gate),
        },
      }),
    };
  }
}
