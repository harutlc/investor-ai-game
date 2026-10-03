import type { OfferInput, StartupPitch } from '@investor/shared';
import type { InvestorState } from './InvestorState.js';

/**
 * The investor's first offer, computed in code: anchor high at the maximum equity, for the founder's ask
 * (never more than the budget). The tutor's "€500k for 30%".
 */
export class OpeningOfferCalculator {
  offer(
    pitch: Pick<StartupPitch, 'askAmount'>,
    state: Pick<InvestorState, 'budget' | 'maxEquity'>,
  ): OfferInput {
    return { investment: Math.min(pitch.askAmount, state.budget), equity: state.maxEquity };
  }
}
