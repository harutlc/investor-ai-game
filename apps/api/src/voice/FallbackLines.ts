import { MoneyFormatter, type OfferInput } from '@investor/shared';
import type { LineSubject } from './VoiceContext.js';

/**
 * Code-written investor lines, used when the thinking model fails or keeps getting the numbers wrong.
 * Persona-neutral and free of player text, so they always pass the number check.
 */
export class FallbackLines {
  line(subject: LineSubject): string {
    const offer = subject.offer ? FallbackLines.offerText(subject.offer) : '';
    switch (subject.kind) {
      case 'opening':
        return `I'm ready to invest ${offer} of your company. That's my opening offer.`;
      case 'counter':
        return `I can do ${offer}. That's my offer.`;
      case 'accept':
        return `You have a deal: ${offer}.`;
      case 'closing':
        return `Deal. ${offer} it is.`;
      case 'reject':
        return `No. My offer stands: ${offer}.`;
      case 'dismiss':
        return `Nice try. My offer stands: ${offer}.`;
      case 'clarify':
        return "I'm not sure what you're proposing. Give me a clear number.";
      case 'walk_away':
        return "I think we're done here.";
    }
  }

  private static offerText(offer: OfferInput): string {
    return `${MoneyFormatter.compact(offer.investment)} for ${offer.equity}%`;
  }
}
