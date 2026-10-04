import type { ChatRole, OfferInput, StartupPitch } from '@investor/shared';
import type { InvestorActionKind } from '../game/InvestorAction.js';
import type { InvestorPersona } from '../personas/InvestorPersona.js';

export interface VoiceMessage {
  role: ChatRole;
  text: string;
}

/**
 * What the voice may know about a game. Deliberately has no investor state and no persona numbers: anything
 * the voice sees can end up in front of the player, so hidden numbers cannot even be passed in.
 */
export interface VoiceContext {
  persona: Pick<InvestorPersona, 'name' | 'personality' | 'toneInstructions'>;
  pitch: StartupPitch;
  /** The chat so far, oldest first; prompts keep the most recent messages. */
  history: readonly VoiceMessage[];
  playerMessage: string | null;
  playerOffer: OfferInput | null;
  /** The investor's offer before this line. */
  previousInvestorOffer: OfferInput | null;
}

/**
 * The line to write, with the offer it states (if any): the opening, the reply to a policy action, or the
 * closing line when the player accepts the investor's offer.
 */
export interface LineSubject {
  kind: InvestorActionKind | 'opening' | 'closing';
  offer: OfferInput | null;
}

/** Lines that must state their offer; the others may only restate it. */
export const MUST_STATE_OFFER: ReadonlySet<LineSubject['kind']> = new Set([
  'opening',
  'counter',
  'accept',
  'closing',
]);
