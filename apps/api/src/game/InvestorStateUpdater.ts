import type { InvestorJudgment } from '../brain/InvestorJudgment.js';
import type { InvestorActionKind } from './InvestorAction.js';
import type { InvestorState } from './InvestorState.js';
import type { PolicySettings } from './PolicySettings.js';

/**
 * Updates the investor's hidden meters after a move, using only `game.policy` weights. Returns a new state;
 * the budget, equity limits and concession step are never changed.
 */
export class InvestorStateUpdater {
  constructor(private readonly settings: PolicySettings) {}

  /** After Stage B: interest follows `good_deal`; rejections and insults cost patience. */
  afterMove(
    state: InvestorState,
    move: { action: InvestorActionKind; judgment: InvestorJudgment },
  ): InvestorState {
    const { patienceCost, insultThreshold, interestWeight } = this.settings;
    const insulted = (move.judgment.conduct?.insult.value ?? 0) >= insultThreshold;
    const cost = (move.action === 'reject' ? patienceCost.reject : 0) + (insulted ? patienceCost.insult : 0);
    const interest = state.interest + (move.judgment.deal.goodDeal.value - 0.5) * interestWeight;
    return {
      ...state,
      interest: Math.round(Math.min(1, Math.max(0, interest)) * 10_000) / 10_000,
      patience: Math.max(0, state.patience - cost),
    };
  }

  /** After a dismissed manipulation attempt: patience only (there is no deal judgment to move interest). */
  afterInjection(state: InvestorState): InvestorState {
    return { ...state, patience: Math.max(0, state.patience - this.settings.patienceCost.injection) };
  }
}
