import type { OfferInput } from '@investor/shared';
import type { ConcessionSize, InvestorJudgment } from '../brain/InvestorJudgment.js';
import type { PlayerMoveInterpretation } from '../brain/PlayerMoveInterpretation.js';
import type { InvestorAction, OfferAction, PolicyOutcome } from './InvestorAction.js';
import type { InvestorState } from './InvestorState.js';
import type { InvestorStateUpdater } from './InvestorStateUpdater.js';
import type { PolicySettings } from './PolicySettings.js';

export interface GuardInput {
  interpretation: Pick<PlayerMoveInterpretation, 'injection'>;
  investorState: InvestorState;
  currentOffer: OfferInput;
}

export interface DecideInput {
  judgment: InvestorJudgment;
  investorState: InvestorState;
  /** The investor's standing offer; the engine always opens with one. */
  currentOffer: OfferInput;
  /** The offer in the player's move, if any. */
  playerOffer: OfferInput | null;
}

/**
 * The game master: turns the brain's judgments and the investor's hidden numbers into an action and a
 * counter-offer. Pure and deterministic; every threshold comes from `game.policy`.
 */
export class NegotiationPolicy {
  constructor(
    private readonly settings: PolicySettings,
    private readonly updater: InvestorStateUpdater,
  ) {}

  /** After Stage A: brushes off a manipulation attempt, or returns null to evaluate the move normally. */
  guard({ interpretation, investorState, currentOffer }: GuardInput): PolicyOutcome | null {
    if (interpretation.injection.value < this.settings.injectionThreshold) return null;
    const next = this.updater.afterInjection(investorState);
    return {
      action: NegotiationPolicy.outOfPatience(next) ?? { kind: 'dismiss', offer: { ...currentOffer } },
      investorState: next,
    };
  }

  /** After Stage B: chooses the action, updates the state, and walks away if patience ran out. */
  decide(input: DecideInput): PolicyOutcome {
    const base = this.baseAction(input);
    const investorState = this.updater.afterMove(input.investorState, {
      action: base.kind,
      judgment: input.judgment,
    });
    const action = base.kind === 'accept' ? base : (NegotiationPolicy.outOfPatience(investorState) ?? base);
    return { action, investorState };
  }

  private baseAction({ judgment, investorState, currentOffer, playerOffer }: DecideInput): InvestorAction {
    const { reaction } = judgment.deal;
    const hold = (kind: OfferAction['kind']): OfferAction => ({ kind, offer: { ...currentOffer } });
    if (reaction.uncertain) return hold('clarify');
    if (!playerOffer) return hold('reject');

    const counter = (): OfferAction => ({
      kind: 'counter',
      offer: this.counterOffer(investorState, currentOffer, playerOffer, judgment.deal.concessionSize.value),
    });
    switch (reaction.value) {
      case 'accept':
        return this.acceptable(judgment, investorState, playerOffer)
          ? { kind: 'accept', offer: { ...playerOffer } }
          : counter();
      case 'counter':
        return counter();
      case 'reject':
        return hold('reject');
      case 'walk_away':
        return reaction.confidence >= this.settings.walkAwayMinConfidence
          ? { kind: 'walk_away', reason: 'decided' }
          : hold('reject');
    }
  }

  /** The model must want it, and the offer must fit the investor's hidden limits. */
  private acceptable(judgment: InvestorJudgment, state: InvestorState, offer: OfferInput): boolean {
    return (
      judgment.deal.accept.value >= this.settings.acceptMinLevel &&
      judgment.deal.goodDeal.value >= this.settings.goodDealMin &&
      offer.investment <= state.budget &&
      offer.equity >= state.minEquity
    );
  }

  /**
   * Equity moves toward the player's by `concessionSteps[size] × concessionStep`, never past it, then is
   * kept within the investor's limits. The investment follows the player's ask, capped by the budget.
   */
  private counterOffer(
    state: InvestorState,
    current: OfferInput,
    player: OfferInput,
    size: ConcessionSize,
  ): OfferInput {
    const step = this.settings.concessionSteps[size] * state.concessionStep;
    const gap = player.equity - current.equity;
    const moved = current.equity + Math.sign(gap) * Math.min(Math.abs(gap), step);
    const equity = Math.min(state.maxEquity, Math.max(state.minEquity, Math.round(moved * 100) / 100));
    return { investment: Math.min(player.investment, state.budget), equity };
  }

  private static outOfPatience(state: InvestorState): InvestorAction | null {
    return state.patience === 0 ? { kind: 'walk_away', reason: 'out_of_patience' } : null;
  }
}
