import { MoneyFormatter, type DecisionAnswer } from '@investor/shared';
import type { ConfidenceGate } from '../../llm/decision/ConfidenceGate.js';
import type { QuestionInput } from '../../llm/decision/DecisionProvider.js';
import { ProviderBadResponseError } from '../../llm/errors/ProviderBadResponseError.js';
import type { BrainMove, PreparedQuestions, StageAQuestionSet } from '../BrainQuestionSet.js';
import type { Judged } from '../Judged.js';
import type { OfferCandidate, OfferCandidateExtractor } from '../OfferCandidateExtractor.js';
import type { PlayerMoveInterpretation } from '../PlayerMoveInterpretation.js';

const NONE = 'none';

/** A choice question built from candidates, and how to map its labels back to their values. */
interface CandidateQuestion {
  question: QuestionInput;
  valueByLabel: Map<string, number>;
}

/**
 * Stage A: which of the numbers code found in the message are the proposed investment and equity. The
 * model picks a label (or `none`); code maps it back to the normalized value, so it never writes a number.
 * A question is only asked for a kind that has candidates.
 */
export class OfferExtractionQuestions implements StageAQuestionSet {
  readonly id = 'offer';
  readonly stage = 'A';

  constructor(private readonly extractor: OfferCandidateExtractor) {}

  prepare(move: BrainMove): PreparedQuestions<Partial<PlayerMoveInterpretation>> | null {
    if (!move.message) return null;
    const { amounts, equities } = this.extractor.extract(move.message);
    const asked: Record<string, CandidateQuestion> = {};
    if (amounts.length > 0) {
      asked.investment = OfferExtractionQuestions.question(
        'Which amount does the player propose that the investor invests?',
        amounts,
        (value) => MoneyFormatter.full(value),
        'The message does not propose an investment amount',
      );
    }
    if (equities.length > 0) {
      asked.equity = OfferExtractionQuestions.question(
        'Which equity stake does the player propose to give the investor?',
        equities,
        (value) => `${value}%`,
        'The message does not propose an equity stake',
      );
    }
    if (Object.keys(asked).length === 0) return null;

    return {
      questions: Object.fromEntries(Object.entries(asked).map(([name, { question }]) => [name, question])),
      interpret: (answers, gate) => ({
        offer: {
          investment: OfferExtractionQuestions.pick(answers, 'investment', asked.investment, gate),
          equity: OfferExtractionQuestions.pick(answers, 'equity', asked.equity, gate),
        },
      }),
    };
  }

  private static question(
    instructions: string,
    candidates: readonly OfferCandidate[],
    label: (value: number) => string,
    noneDescription: string,
  ): CandidateQuestion {
    const valueByLabel = new Map<string, number>();
    const criteria: Record<string, string> = {};
    for (const candidate of candidates) {
      const text = label(candidate.value);
      valueByLabel.set(text, candidate.value);
      criteria[text] = `Written as "${candidate.text}" in the message`;
    }
    criteria[NONE] = noneDescription;
    return { question: { type: 'choice', instructions, criteria }, valueByLabel };
  }

  /** The chosen candidate's value; null for `none`, an unasked question or a label that is not a candidate. */
  private static pick(
    answers: Readonly<Record<string, DecisionAnswer>>,
    name: string,
    asked: CandidateQuestion | undefined,
    gate: ConfidenceGate,
  ): Judged<number> | null {
    if (!asked) return null;
    const answer = answers[name];
    if (answer?.type !== 'choice') {
      throw new ProviderBadResponseError(`Decision answer "${name}" is missing or not a choice`);
    }
    const value = asked.valueByLabel.get(answer.value);
    return value === undefined ? null : { value, ...gate.assess(answer) };
  }
}
