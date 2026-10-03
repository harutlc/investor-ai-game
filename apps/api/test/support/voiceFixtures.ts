import type { OfferInput } from '@investor/shared';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';
import type { ThinkingProvider } from '../../src/llm/thinking/ThinkingProvider.js';
import { InvestorPersona } from '../../src/personas/InvestorPersona.js';
import { FallbackLines } from '../../src/voice/FallbackLines.js';
import { LineWriter } from '../../src/voice/LineWriter.js';
import { NumberConsistencyChecker } from '../../src/voice/NumberConsistencyChecker.js';
import { NumbersInPlay } from '../../src/voice/NumbersInPlay.js';
import { PromptBuilder } from '../../src/voice/PromptBuilder.js';
import type { VoiceContext, VoiceMessage } from '../../src/voice/VoiceContext.js';
import { definition } from './personaFixtures.js';

export const voicePersona = new InvestorPersona(definition);
export const OPENING: OfferInput = { investment: 500_000, equity: 30 };

/** GreenCharge at €2M asking €500k; the investor opened at €500k for 30%. */
export function voiceContext(overrides: Partial<VoiceContext> = {}): VoiceContext {
  const history: VoiceMessage[] = [
    { role: 'system', text: 'Negotiation started.' },
    { role: 'investor', text: "I'll put in €500k for 30%." },
  ];
  return {
    persona: voicePersona,
    pitch: {
      name: 'GreenCharge',
      sector: 'EV charging',
      description: 'Fast chargers for apartment buildings. €18k monthly revenue, growing 12% a month.',
      valuation: 2_000_000,
      askAmount: 500_000,
    },
    history,
    playerMessage: null,
    playerOffer: null,
    previousInvestorOffer: OPENING,
    ...overrides,
  };
}

const extractor = new OfferCandidateExtractor();
export const numbersInPlay = new NumbersInPlay(extractor);

export function lineWriter(provider: ThinkingProvider): LineWriter {
  return new LineWriter(
    provider,
    new PromptBuilder(),
    numbersInPlay,
    new NumberConsistencyChecker(extractor),
    new FallbackLines(),
  );
}
