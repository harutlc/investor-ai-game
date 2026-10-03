import type { OfferInput } from '@investor/shared';
import type { InvestorState } from './InvestorState.js';

/** Actions that keep the negotiation going (or close it with `accept`) and carry the offer the investor stands behind. */
export type OfferAction = {
  /**
   * `accept`: the player's offer, accepted. `counter`: a new offer computed by code. `reject`, `clarify`,
   * `dismiss`: the investor's unchanged current offer.
   */
  kind: 'accept' | 'counter' | 'reject' | 'clarify' | 'dismiss';
  offer: OfferInput;
};

export type WalkAwayReason = 'out_of_patience' | 'decided';

/** What the investor does this turn. Decided by code; the voice only phrases it. */
export type InvestorAction = OfferAction | { kind: 'walk_away'; reason: WalkAwayReason };

export type InvestorActionKind = InvestorAction['kind'];

/** The policy's result: the action and the investor's updated hidden state. */
export interface PolicyOutcome {
  action: InvestorAction;
  investorState: InvestorState;
}
