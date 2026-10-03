import { MoneyFormatter, ValuationCalculator, type Offer, type OfferInput } from '@investor/shared';
import type { InvestorPersona } from '../personas/InvestorPersona.js';
import type { GameSession } from '../repositories/GameSessionRepository.js';
import type { NegotiationState } from './NegotiationState.js';
import type { PlayerIntent } from './PlayerIntent.js';

/** How many earlier offers the history keeps; older ones add tokens but little judgment. */
export const HISTORY_LIMIT = 10;

export interface NegotiationStateInput {
  session: Pick<GameSession, 'phase' | 'turn' | 'pitch' | 'currentInvestorOffer' | 'investorState'>;
  persona: Pick<InvestorPersona, 'personality' | 'goals'>;
  /** The offer in this move, if it contains one. */
  playerOffer?: OfferInput | null;
  /** The move's text, if it has any. */
  playerMessage?: string | null;
  /** Stage A's classification, once known. */
  playerIntent?: PlayerIntent | null;
  /** Offers made before this move, in turn order. */
  earlierOffers: readonly Pick<Offer, 'from' | 'investment' | 'equity'>[];
}

/**
 * Builds the decision state for a move. Pure: the engine loads the session, persona and offers. Investor
 * numbers come from the session's investor state, which the policy changes during the game, not from the
 * persona's starting numbers. Absent values are left out, so the state is always valid JSON.
 */
export class NegotiationStateBuilder {
  constructor(private readonly maxTurns: number) {}

  build(input: NegotiationStateInput): NegotiationState {
    const { session, persona, playerOffer, playerMessage, playerIntent } = input;
    const investor = session.investorState;
    const current = session.currentInvestorOffer;

    const state: NegotiationState = {
      phase: session.phase,
      turn: session.turn,
      turns_left: Math.max(0, this.maxTurns - session.turn),
      startup: {
        name: session.pitch.name,
        sector: session.pitch.sector,
        pitch: session.pitch.description,
        valuation_ask: session.pitch.valuation,
        ask_amount: session.pitch.askAmount,
      },
      investor: {
        personality: persona.personality,
        goals: [...persona.goals],
        budget: investor.budget,
        min_equity: investor.minEquity,
        max_equity: investor.maxEquity,
        interest: investor.interest,
        patience: investor.patience,
        ...(current && { current_offer: { investment: current.investment, equity: current.equity } }),
      },
      history: NegotiationStateBuilder.history(input.earlierOffers),
    };
    if (playerOffer) {
      state.player_offer = {
        investment: playerOffer.investment,
        equity: playerOffer.equity,
        implied_valuation: ValuationCalculator.impliedPostMoney(playerOffer.investment, playerOffer.equity),
        within_budget: playerOffer.investment <= investor.budget,
        meets_min_equity: playerOffer.equity >= investor.minEquity,
      };
    }
    if (playerMessage) state.player_message = playerMessage;
    if (playerIntent) state.player_intent = playerIntent;
    return state;
  }

  /** "Investor offered €500k for 30%", "Player countered €500k for 12%": countered when answering the other side. */
  private static history(offers: NegotiationStateInput['earlierOffers']): string[] {
    const lines = offers.map((offer, index) => {
      const side = offer.from === 'investor' ? 'Investor' : 'Player';
      const previous = offers[index - 1];
      const verb = previous && previous.from !== offer.from ? 'countered' : 'offered';
      return `${side} ${verb} ${MoneyFormatter.compact(offer.investment)} for ${offer.equity}%`;
    });
    return lines.slice(-HISTORY_LIMIT);
  }
}
