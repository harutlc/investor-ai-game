import { ValuationCalculator, type OfferInput } from '@investor/shared';
import type { OfferCandidateExtractor } from '../brain/OfferCandidateExtractor.js';
import { MUST_STATE_OFFER, type LineSubject, type VoiceContext } from './VoiceContext.js';

/** The numbers a generated line may mention, and the offer it must state (if any). */
export interface AllowedNumbers {
  amounts: number[];
  equities: number[];
  required: OfferInput | null;
}

/**
 * Collects the numbers in play for a line: the offers on the table, their valuations and the gaps between
 * them, the pitch's ask, and whatever numbers the player wrote themselves. Nothing else may appear in a generated line.
 */
export class NumbersInPlay {
  constructor(private readonly extractor: OfferCandidateExtractor) {}

  for(context: VoiceContext, subject: LineSubject): AllowedNumbers {
    const offers = [subject.offer, context.previousInvestorOffer, context.playerOffer].filter(
      (offer): offer is OfferInput => offer !== null,
    );
    const amounts = [context.pitch.valuation, context.pitch.askAmount];
    const equities: number[] = [];
    for (const offer of offers) {
      const post = ValuationCalculator.impliedPostMoney(offer.investment, offer.equity);
      amounts.push(offer.investment, post, post - offer.investment);
      equities.push(offer.equity);
    }
    // Gaps between offers ("the extra €50k", "4 points apart") only restate numbers already on the table.
    for (const [i, a] of offers.entries()) {
      for (const b of offers.slice(i + 1)) {
        const amountGap = Math.abs(a.investment - b.investment);
        const equityGap = Math.round(Math.abs(a.equity - b.equity) * 100) / 100;
        if (amountGap > 0) amounts.push(amountGap);
        if (equityGap > 0) equities.push(equityGap);
      }
    }
    for (const text of [context.pitch.description, context.playerMessage ?? '']) {
      const found = this.extractor.extract(text);
      amounts.push(...found.amounts.map((candidate) => candidate.value));
      equities.push(...found.equities.map((candidate) => candidate.value));
    }
    return {
      amounts: [...new Set(amounts)],
      equities: [...new Set(equities)],
      required: MUST_STATE_OFFER.has(subject.kind) ? subject.offer : null,
    };
  }
}
