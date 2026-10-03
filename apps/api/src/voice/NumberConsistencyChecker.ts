import { MoneyFormatter } from '@investor/shared';
import type { OfferCandidateExtractor } from '../brain/OfferCandidateExtractor.js';
import type { AllowedNumbers } from './NumbersInPlay.js';

export interface ConsistencyResult {
  ok: boolean;
  /** Plain-English problems, fed back to the model on a retry. */
  problems: string[];
}

/** Relative and absolute slack for amounts, so "€3.3M" matches €3,333,333. */
const AMOUNT_TOLERANCE = 0.02;
const AMOUNT_MIN_SLACK = 1_000;
const EQUITY_TOLERANCE = 0.005;

/**
 * Checks that a generated line only mentions numbers in play and states the decided offer. Reads numbers
 * with the same extractor as Stage A, so the voice and the brain agree on what a number is.
 */
export class NumberConsistencyChecker {
  constructor(private readonly extractor: OfferCandidateExtractor) {}

  check(text: string, allowed: AllowedNumbers): ConsistencyResult {
    const { amounts, equities } = this.extractor.extract(text);
    const problems: string[] = [];
    for (const { text: token, value } of amounts) {
      if (!allowed.amounts.some((amount) => NumberConsistencyChecker.sameAmount(value, amount))) {
        problems.push(`You wrote "${token}", which is not an amount in this negotiation.`);
      }
    }
    for (const { text: token, value } of equities) {
      if (!allowed.equities.some((equity) => Math.abs(value - equity) < EQUITY_TOLERANCE)) {
        problems.push(`You wrote "${token}", which is not a percentage in this negotiation.`);
      }
    }
    const required = allowed.required;
    if (required) {
      const statesAmount = amounts.some(({ value }) =>
        NumberConsistencyChecker.sameAmount(value, required.investment),
      );
      const statesEquity = equities.some(({ value }) => Math.abs(value - required.equity) < EQUITY_TOLERANCE);
      if (!statesAmount || !statesEquity) {
        problems.push(
          `You must state the offer exactly: ${MoneyFormatter.compact(required.investment)} for ${required.equity}%.`,
        );
      }
    }
    return { ok: problems.length === 0, problems };
  }

  private static sameAmount(value: number, expected: number): boolean {
    return Math.abs(value - expected) <= Math.max(expected * AMOUNT_TOLERANCE, AMOUNT_MIN_SLACK);
  }
}
