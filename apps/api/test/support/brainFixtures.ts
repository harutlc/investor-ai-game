import type { ChoiceAnswer, NoulAnswer, OfferInput, ScoreAnswer } from '@investor/shared';
import type { BrainMove } from '../../src/brain/BrainQuestionSet.js';
import { NegotiationStateBuilder } from '../../src/brain/NegotiationStateBuilder.js';
import { InvestorPersona } from '../../src/personas/InvestorPersona.js';
import { sessionFixture } from './gameFixtures.js';
import { definition } from './personaFixtures.js';

export const brainPersona = new InvestorPersona(definition);

/** A move against the fixture session (budget €700k, investor offer €500k for 30%). */
export function brainMove(message: string | null, playerOffer: OfferInput | null = null): BrainMove {
  const session = sessionFixture('player-1', { turn: 1 });
  const state = new NegotiationStateBuilder(15).build({
    session,
    persona: brainPersona,
    playerOffer,
    playerMessage: message,
    earlierOffers: [session.currentInvestorOffer!],
  });
  return { state, message };
}

export function choice(value: string, confidence = 0.9): ChoiceAnswer {
  return { type: 'choice', value, confidence, probabilities: { [value]: confidence } };
}

export function noul(probability: number): NoulAnswer {
  return { type: 'noul', probability };
}

export function score(value: number, confidence = 0.9): ScoreAnswer {
  return { type: 'score', value, confidence, probabilities: { [String(Math.round(value))]: confidence } };
}
