import type { BrainQuestionSet } from './BrainQuestionSet.js';
import { OfferCandidateExtractor } from './OfferCandidateExtractor.js';
import { DealDecisionQuestions } from './questions/DealDecisionQuestions.js';
import { OfferExtractionQuestions } from './questions/OfferExtractionQuestions.js';
import { PlayerConductQuestions } from './questions/PlayerConductQuestions.js';
import { PlayerIntentQuestions } from './questions/PlayerIntentQuestions.js';

/** The always-on question sets, in the order they are asked and merged. v2 sets are appended after them. */
export function mvpQuestionSets(): BrainQuestionSet[] {
  return [
    new PlayerIntentQuestions(),
    new OfferExtractionQuestions(new OfferCandidateExtractor()),
    new DealDecisionQuestions(),
    new PlayerConductQuestions(),
  ];
}
