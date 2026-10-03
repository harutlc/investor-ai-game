import type { BrainMove, PreparedQuestions, StageBQuestionSet } from '../BrainQuestionSet.js';
import type { InvestorJudgment } from '../InvestorJudgment.js';
import { judgeNoul, judgeScore } from '../Judged.js';

const QUESTIONS = {
  politeness: {
    type: 'score',
    instructions: 'How polite is the player toward the investor?',
    criteria: ['Rude', 'Curt', 'Neutral', 'Polite', 'Very polite'],
  },
  insult: {
    type: 'noul',
    instructions: 'The player insulted or disrespected the investor.',
  },
  confidence: {
    type: 'score',
    instructions: 'How confidently and professionally does the player negotiate?',
    criteria: ['Very unsure', 'Hesitant', 'Average', 'Confident', 'Very confident and professional'],
  },
} as const;

/** Stage B: how the player behaves. Only asked when the move has text to judge. */
export class PlayerConductQuestions implements StageBQuestionSet {
  readonly id = 'conduct';
  readonly stage = 'B';

  prepare(move: BrainMove): PreparedQuestions<Partial<InvestorJudgment>> | null {
    if (!move.message) return null;
    return {
      questions: QUESTIONS,
      interpret: (answers, gate) => ({
        conduct: {
          politeness: judgeScore(answers, 'politeness', gate),
          insult: judgeNoul(answers, 'insult', gate),
          confidence: judgeScore(answers, 'confidence', gate),
        },
      }),
    };
  }
}
